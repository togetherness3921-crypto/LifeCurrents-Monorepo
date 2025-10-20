export interface GraphDocumentUpdate {
    document: any;
    versionId?: string | null;
    source: 'patch' | 'revert' | 'latest';
}

