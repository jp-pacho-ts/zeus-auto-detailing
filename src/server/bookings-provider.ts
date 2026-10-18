import "server-only";
// Provider bodies are untrusted too: cap the stream before buffering/JSON parsing.
export async function readProviderJson(response: Response): Promise<unknown> {
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error("Empty provider response");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.byteLength;
            if (bytes > 16384) {
                await reader.cancel();
                throw new Error("Provider response too large");
            }
            chunks.push(value);
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    }
    finally {
        reader.releaseLock();
    }
}
