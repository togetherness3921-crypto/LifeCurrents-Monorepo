const PROMPT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

const PROMPT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
});

const DISPLAY_FORMAT = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
});

export const formatPromptTimestamp = (date?: Date): string => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return '[--:-- | --- --]';
    }
    const time = PROMPT_TIME_FORMAT.format(date);
    const day = PROMPT_DATE_FORMAT.format(date);
    return `[${time} | ${day}]`;
};

export const prefixWithPromptTimestamp = (content: string, date?: Date): string => {
    const base = formatPromptTimestamp(date);
    const text = content ?? '';
    const needsSpace = text.length > 0 && !/^[\s\n]/.test(text);
    return `${base}${needsSpace ? ' ' : ''}${text}`;
};

export const formatDisplayTimestamp = (date?: Date): string => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return 'Time unknown';
    }
    return DISPLAY_FORMAT.format(date);
};
