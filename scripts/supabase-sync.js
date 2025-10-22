const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');

const SUPABASE_URL = "https://cvzgxnspmmxxxwnxiydk.supabase.co";
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2emd4bnNwbW14eHh3bnhpeWRrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njg3NzM1OCwiZXhwIjoyMDcyNDUzMzU4fQ.ZDl4Y3OQOeEeZ_QajGB6iRr0Xk3_Z7TMlI92yFmerzI";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SYNCED_FILES_DIR = path.resolve(process.cwd(), 'synced_files');
const GRAPH_DATA_PATH = path.join(SYNCED_FILES_DIR, 'graph_data.json');
const SYSTEM_INSTRUCTIONS_DIR = path.join(SYNCED_FILES_DIR, 'system_instructions');
const LEGACY_SYSTEM_INSTRUCTIONS_PATH = path.join(SYNCED_FILES_DIR, 'system_instructions.ts');

let isWritingRemote = false;
let isWritingLocal = false;
let localLockCount = 0;
let remoteLockCount = 0;

const fileIdMap = new Map(); // filePath -> id
const idFileMap = new Map(); // id -> filePath
const pendingDeleteTimers = new Map(); // id -> timeout handle

function toTimestamp(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isNaN(time) ? null : time;
}

async function getFileMtimeMs(filePath) {
    try {
        const stats = await fs.stat(filePath);
        return stats.mtimeMs;
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

function isLocalNewer(localMtime, remoteTimestamp) {
    if (!localMtime) return false;
    if (remoteTimestamp == null) return true;
    return localMtime > remoteTimestamp;
}

function isRemoteNewer(localMtime, remoteTimestamp) {
    if (remoteTimestamp == null) return false;
    if (!localMtime) return true;
    return remoteTimestamp > localMtime;
}

async function ensureDirExists(dirPath) {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

async function ensureDirectories() {
    await ensureDirExists(SYNCED_FILES_DIR);
    await ensureDirExists(SYSTEM_INSTRUCTIONS_DIR);
}

function releaseLocalLock() {
    localLockCount = Math.max(0, localLockCount - 1);
    if (localLockCount === 0) {
        setTimeout(() => {
            if (localLockCount === 0) {
                isWritingLocal = false;
            }
        }, 200);
    }
}

function releaseRemoteLock() {
    remoteLockCount = Math.max(0, remoteLockCount - 1);
    if (remoteLockCount === 0) {
        setTimeout(() => {
            if (remoteLockCount === 0) {
                isWritingRemote = false;
            }
        }, 200);
    }
}

async function withRemoteWriteLock(fn) {
    remoteLockCount += 1;
    isWritingRemote = true;
    try {
        return await fn();
    } finally {
        releaseRemoteLock();
    }
}

function escapeTemplateString(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$\{/g, '\\${');
}

function unescapeTemplateString(value) {
    return value
        .replace(/\\`/g, '`')
        .replace(/\\\$\{/g, '${')
        .replace(/\\\\/g, '\\');
}

function serializeInstruction({ id, title, content }) {
    const escapedTitle = escapeTemplateString(title ?? '');
    const escapedContent = escapeTemplateString(content ?? '');
    const idLine = id ? `  id: '${id}',\n` : '';
    return `export default {\n${idLine}  title: \`${escapedTitle}\`,\n  content: \`${escapedContent}\`\n};\n`;
}

function parseInstructionFile(raw) {
    const idMatch = raw.match(/id:\s*['\"]([^'\"]+)['\"]/);
    const titleMatch = raw.match(/title:\s*`([\s\S]*?)`/);
    const contentMatch = raw.match(/content:\s*`([\s\S]*?)`/);

    if (!titleMatch || !contentMatch) {
        return null;
    }

    return {
        id: idMatch?.[1] ?? undefined,
        title: unescapeTemplateString(titleMatch[1]),
        content: unescapeTemplateString(contentMatch[1]),
    };
}

function toPascalCase(input) {
    const words = input
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    return words.length ? words.join('') : 'Instruction';
}

function getInstructionFilePath(title, id, currentPath) {
    const baseName = toPascalCase(title || 'Instruction');
    let attempt = 0;
    let candidate;

    do {
        const suffix = attempt ? `_${attempt}` : '';
        candidate = path.join(SYSTEM_INSTRUCTIONS_DIR, `${baseName}${suffix}.ts`);
        const existingId = fileIdMap.get(candidate);
        if (!existingId || existingId === id || candidate === currentPath) {
            break;
        }
        attempt += 1;
    } while (attempt < 1000);

    return candidate;
}

async function withLocalWriteLock(fn) {
    localLockCount += 1;
    isWritingLocal = true;
    try {
        await fn();
    } finally {
        releaseLocalLock();
    }
}

async function writeInstructionToFile(instruction, currentPath) {
    const targetPath = getInstructionFilePath(instruction.title, instruction.id, currentPath);
    const content = serializeInstruction(instruction);

    await withLocalWriteLock(async () => {
        await ensureDirExists(path.dirname(targetPath));
        await fs.writeFile(targetPath, content);
        if (currentPath && currentPath !== targetPath) {
            try {
                await fs.unlink(currentPath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
    });

    if (instruction.id) {
        fileIdMap.set(targetPath, instruction.id);
        idFileMap.set(instruction.id, targetPath);
    }

    if (currentPath && currentPath !== targetPath) {
        fileIdMap.delete(currentPath);
    }

    return targetPath;
}

async function removeInstructionFile(filePath, id) {
    await withLocalWriteLock(async () => {
        try {
            await fs.unlink(filePath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    });
    fileIdMap.delete(filePath);
    if (id) {
        idFileMap.delete(id);
    }
}

async function fetchRemoteInstructions() {
    const { data, error } = await supabase
        .from('system_instructions')
        .select('id, title, content, updated_at')
        .order('updated_at', { ascending: true });

    if (error) {
        throw new Error(`Error fetching system instructions: ${error.message}`);
    }

    return data ?? [];
}

async function fetchInstructionById(id) {
    const { data, error } = await supabase
        .from('system_instructions')
        .select('id, title, content, updated_at')
        .eq('id', id)
        .single();

    if (error) {
        if (error.code === 'PGRST116') {
            return null; // This is a confirmed "not found", not an error.
        }
        throw new Error(`Error fetching system instruction ${id}: ${error.message}`);
    }

    return data ?? null;
}

async function migrateLegacyInstructionIfPresent(remoteInstructions) {
    if (remoteInstructions.length > 0) {
        return remoteInstructions;
    }

    try {
        await fs.access(LEGACY_SYSTEM_INSTRUCTIONS_PATH);
    } catch {
        return remoteInstructions;
    }

    try {
        const raw = await fs.readFile(LEGACY_SYSTEM_INSTRUCTIONS_PATH, 'utf-8');
        const contentMatch = raw.match(/`([\s\S]*)`/);
        const content = contentMatch ? contentMatch[1] : '';
        if (!content.trim()) {
            await fs.unlink(LEGACY_SYSTEM_INSTRUCTIONS_PATH);
            return remoteInstructions;
        }

        console.log('Migrating legacy system_instructions.ts into Supabase...');
        const insertResult = await withRemoteWriteLock(() =>
            supabase
                .from('system_instructions')
                .insert({ title: 'Main Instruction', content })
        );
        const insertError = insertResult?.error;
        if (insertError) {
            console.error('Failed to migrate legacy system instructions:', insertError.message);
        } else {
            console.log('Legacy system instructions migrated.');
        }
    } catch (error) {
        console.error('Error during legacy migration:', error.message);
    } finally {
        try {
            await fs.unlink(LEGACY_SYSTEM_INSTRUCTIONS_PATH);
        } catch (error) {
            if (error.code !== 'ENOENT') console.error('Failed to remove legacy instructions file:', error.message);
        }
    }

    return fetchRemoteInstructions();
}

async function removeLegacyInstructionFileIfExists() {
    try {
        await fs.unlink(LEGACY_SYSTEM_INSTRUCTIONS_PATH);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error('Failed to remove legacy system instructions file:', error.message);
        }
    }
}

async function reconcileInstructionsFromRemote(remoteInstructions) {
    fileIdMap.clear();
    idFileMap.clear();
    const localFiles = await fs.readdir(SYSTEM_INSTRUCTIONS_DIR).catch(() => []);
    const unmatchedLocalFiles = new Map();

    for (const fileName of localFiles) {
        if (!fileName.endsWith('.ts')) continue;
        const filePath = path.join(SYSTEM_INSTRUCTIONS_DIR, fileName);
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const parsed = parseInstructionFile(raw);
            const mtimeMs = await getFileMtimeMs(filePath);
            if (parsed?.id) {
                unmatchedLocalFiles.set(parsed.id, { filePath, parsed, mtimeMs });
                fileIdMap.set(filePath, parsed.id);
                idFileMap.set(parsed.id, filePath);
            } else {
                unmatchedLocalFiles.set(filePath, { filePath, parsed, mtimeMs });
            }
        } catch (error) {
            console.error(`Failed to parse local instruction file ${fileName}:`, error.message);
        }
    }

    for (const instruction of remoteInstructions) {
        const match = unmatchedLocalFiles.get(instruction.id);
        const currentPath = match?.filePath;
        const localMtime = match?.mtimeMs ?? null;
        const remoteUpdated = toTimestamp(instruction.updated_at);

        if (isLocalNewer(localMtime, remoteUpdated)) {
            const localName = currentPath ? path.basename(currentPath) : '(new file)';
            console.log(
                `[Conflict] Local instruction file ${localName} is newer. Syncing to Supabase.`
            );
            const remoteData = await upsertInstructionRemote({ ...match.parsed, id: instruction.id });
            if (remoteData) {
                await writeInstructionToFile(remoteData, currentPath);
            }
            unmatchedLocalFiles.delete(instruction.id);
            continue;
        }

        const finalPath = await writeInstructionToFile(instruction, currentPath);
        console.log(`Synced instruction "${instruction.title}" (${instruction.id}) to ${path.basename(finalPath)}.`);
        unmatchedLocalFiles.delete(instruction.id);
    }

    for (const entry of unmatchedLocalFiles.values()) {
        if (!entry.parsed) {
            await removeInstructionFile(entry.filePath, undefined);
            console.log(`Removed unparsable instruction file ${path.basename(entry.filePath)}.`);
            continue;
        }

        const payload = { ...entry.parsed };

        if (payload.id) {
            const remoteInstruction = await fetchInstructionById(payload.id);
            if (!remoteInstruction) {
                console.log(
                    `[Conflict] Local instruction file ${path.basename(
                        entry.filePath
                    )} refers to a deleted remote record. Removing local file.`
                );
                await removeInstructionFile(entry.filePath, payload.id);
                continue;
            }
        }

        console.log(
            `[Conflict] Local-only instruction file ${path.basename(entry.filePath)} detected. Syncing to Supabase.`
        );
        const remoteData = await upsertInstructionRemote(payload);
        if (remoteData) {
            await writeInstructionToFile(remoteData, entry.filePath);
        }
    }
}

async function fetchGraphDocument() {
    const { data, error } = await supabase
        .from('graph_documents')
        .select('data, updated_at')
        .eq('id', 'main')
        .single();

    if (error) {
        throw new Error(`Error fetching graph data: ${error.message}`);
    }

    return data ?? null;
}

async function syncGraphDataFromSupabase() {
    try {
        const graphData = await fetchGraphDocument();
        if (!graphData) return;

        const remoteUpdated = toTimestamp(graphData.updated_at);
        const localMtime = await getFileMtimeMs(GRAPH_DATA_PATH);

        if (isLocalNewer(localMtime, remoteUpdated)) {
            console.log('[Conflict] Local graph_data.json is newer. Syncing changes to Supabase.');
            await updateGraphDataRemotely();
            return;
        }

        await withLocalWriteLock(async () => {
            await fs.writeFile(GRAPH_DATA_PATH, JSON.stringify(graphData.data, null, 2));
        });
        console.log('Synced graph_data.json from Supabase.');
    } catch (error) {
        console.error('Error syncing graph_data.json to Supabase:', error.message);
    }
}

async function syncFromSupabase() {
    console.log('Performing initial sync from Supabase...');

    await syncGraphDataFromSupabase();

    let remoteInstructions = await fetchRemoteInstructions();
    remoteInstructions = await migrateLegacyInstructionIfPresent(remoteInstructions);
    await reconcileInstructionsFromRemote(remoteInstructions);
    await removeLegacyInstructionFileIfExists();

    console.log('Initial sync complete.');
}

async function updateGraphDataRemotely() {
    try {
        const content = await fs.readFile(GRAPH_DATA_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        const localMtime = await getFileMtimeMs(GRAPH_DATA_PATH);
        const graphData = await fetchGraphDocument();
        const remoteUpdated = toTimestamp(graphData?.updated_at);

        if (isRemoteNewer(localMtime, remoteUpdated)) {
            console.log('[Conflict] Remote graph_data.json is newer. Refreshing local copy.');
            await syncGraphDataFromSupabase();
            return;
        }

        await withRemoteWriteLock(async () => {
            const { error } = await supabase
                .from('graph_documents')
                .update({ data: parsed })
                .eq('id', 'main');
            if (error) throw error;
        });
        console.log('Successfully synced graph_data.json to Supabase.');
    } catch (error) {
        console.error('Error syncing graph_data.json to Supabase:', error.message);
    }
}

async function upsertInstructionRemote(instruction) {
    try {
        const payload = {
            title: instruction.title,
            content: instruction.content,
        };
        if (instruction.id) {
            payload.id = instruction.id;
        }

        return await withRemoteWriteLock(async () => {
            const { data, error } = await supabase
                .from('system_instructions')
                .upsert(payload, { onConflict: 'id' })
                .select('id, title, content, updated_at')
                .single();
            if (error) throw error;
            return data;
        });
    } catch (error) {
        console.error('Error syncing system instruction to Supabase:', error.message);
        return null;
    }
}

async function deleteInstructionRemote(id) {
    if (!id) return;
    try {
        await withRemoteWriteLock(async () => {
            const { error } = await supabase
                .from('system_instructions')
                .delete()
                .eq('id', id);
            if (error) throw error;
        });
        console.log(`Deleted system instruction ${id} from Supabase.`);
    } catch (error) {
        console.error('Error deleting system instruction:', error.message);
    }
}

async function handleInstructionFileChange(filePath) {
    if (isWritingLocal) return;

    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = parseInstructionFile(raw);
        if (!parsed) {
            console.warn(`Unable to parse instruction file ${path.basename(filePath)}. Skipping.`);
            return;
        }

        const localMtime = await getFileMtimeMs(filePath);
        let remoteExisting = null;

        if (parsed.id) {
            remoteExisting = await fetchInstructionById(parsed.id);
            const remoteUpdated = toTimestamp(remoteExisting?.updated_at);
            if (isRemoteNewer(localMtime, remoteUpdated)) {
                const title = remoteExisting?.title ?? parsed.title ?? 'Unknown';
                console.log(
                    `[Conflict] Remote instruction "${title}" is newer. Restoring local file from Supabase.`
                );
                if (remoteExisting) {
                    await writeInstructionToFile(remoteExisting, filePath);
                } else {
                    console.warn(
                        `Failed to restore remote instruction for id ${parsed.id} because no remote record was found.`
                    );
                }
                return;
            }

            cancelPendingDeletionIfNeeded(parsed.id);
        }

        const remoteData = await upsertInstructionRemote(parsed);
        if (!remoteData) return;

        const finalPath = await writeInstructionToFile(remoteData, filePath);
        console.log(`Synced instruction "${remoteData.title}" (${remoteData.id}) from local file ${path.basename(finalPath)}.`);
    } catch (error) {
        console.error(`Failed to process instruction file ${path.basename(filePath)}:`, error.message);
    }
}

function scheduleRemoteDeletion(id, filePath) {
    if (!id) {
        console.warn(`Deleted local instruction file ${path.basename(filePath)} without id. Removing file only.`);
        return;
    }

    if (pendingDeleteTimers.has(id)) {
        clearTimeout(pendingDeleteTimers.get(id));
    }

    const timer = setTimeout(async () => {
        pendingDeleteTimers.delete(id);
        await deleteInstructionRemote(id);
    }, 750);

    pendingDeleteTimers.set(id, timer);
}

async function handleInstructionFileDelete(filePath) {
    if (isWritingLocal) return;

    const id = fileIdMap.get(filePath);
    fileIdMap.delete(filePath);
    if (id) {
        idFileMap.delete(id);
    }

    scheduleRemoteDeletion(id, filePath);
}

async function startInstructionWatcher() {
    const watcher = chokidar.watch(path.join(SYSTEM_INSTRUCTIONS_DIR, '*.ts'), {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
        },
    });

    watcher.on('add', handleInstructionFileChange);
    watcher.on('change', handleInstructionFileChange);
    watcher.on('unlink', handleInstructionFileDelete);
}

function cancelPendingDeletionIfNeeded(id) {
    if (!id) return;
    const timer = pendingDeleteTimers.get(id);
    if (timer) {
        clearTimeout(timer);
        pendingDeleteTimers.delete(id);
    }
}

async function startFileWatcher() {
    const watcher = chokidar.watch([GRAPH_DATA_PATH], { persistent: true, ignoreInitial: true });
    watcher.on('change', async (filePath) => {
        if (isWritingLocal) return;
        if (filePath === GRAPH_DATA_PATH) {
            await updateGraphDataRemotely();
        }
    });

    await startInstructionWatcher();
}

async function handleRemoteInstructionChange(payload) {
    const eventType = payload.eventType;
    const record = payload.new ?? payload.old;
    const id = record?.id;

    if (!id) return;

    cancelPendingDeletionIfNeeded(id);

    if (eventType === 'DELETE') {
        const filePath = idFileMap.get(id);
        if (filePath) {
            await removeInstructionFile(filePath, id);
            console.log(`Removed instruction file for deleted record ${id}.`);
        }
        return;
    }

    if (!payload.new) return;

    const existingPath = idFileMap.get(id);
    const remoteUpdated = toTimestamp(payload.new.updated_at);
    if (existingPath) {
        const localMtime = await getFileMtimeMs(existingPath);
        if (isLocalNewer(localMtime, remoteUpdated)) {
            console.log(
                `[Conflict] Local instruction file ${path.basename(existingPath)} is newer than remote change. Syncing to Supabase.`
            );
            try {
                const localRaw = await fs.readFile(existingPath, 'utf-8');
                const localParsed = parseInstructionFile(localRaw);
                if (localParsed) {
                    await upsertInstructionRemote({ ...localParsed, id });
                }
            } catch (error) {
                console.error(`Failed to read local instruction file ${path.basename(existingPath)}:`, error.message);
            }
            return;
        }
    }

    await writeInstructionToFile(payload.new, existingPath);
    console.log(`Updated instruction file for "${payload.new.title}" (${id}).`);
}

function startSupabaseListener() {
    const channel = supabase.channel('public:synced_files');

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'graph_documents', filter: 'id=eq.main' }, async (payload) => {
        if (isWritingRemote) return;
        console.log('Remote change detected for graph_data.json. Syncing locally...');
        await syncGraphDataFromSupabase();
    });

    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'system_instructions' }, async (payload) => {
        if (isWritingRemote) return;
        await handleRemoteInstructionChange(payload);
    });

    channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log('Connected to Supabase for real-time updates.');
        }
    });
}

async function main() {
    await ensureDirectories();
    await syncFromSupabase();
    await startFileWatcher();
    startSupabaseListener();
    console.log('Supabase sync utility is running and watching for changes...');
}

main().catch((error) => {
    console.error('Supabase sync encountered an error:', error);
    process.exit(1);
});
