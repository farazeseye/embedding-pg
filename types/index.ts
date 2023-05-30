export type PGEssay = {
    title: string;
    url: string;
    content: string;
    tokens: number;
    chunks: PGChunk[];
}

export type PGChunk = {
    essay_title: string;
    essay_url: string;
    content: string;
    content_length: number,
    content_tokens: number;
    embedding: number[];
}

export type PGJSON = {
    total_tokens: number;
    total_essays: number;
    essays: PGEssay[];
}




