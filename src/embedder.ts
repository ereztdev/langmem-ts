import OpenAI from "openai";
import type { Embedder, OpenAIEmbedderConfig } from "./types.js";

const DEFAULT_MODEL = "text-embedding-3-large";
const DEFAULT_DIMENSIONS = 1536;

export class OpenAIEmbedder implements Embedder {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;

  constructor(config: OpenAIEmbedderConfig, client?: OpenAI) {
    if (!config.apiKey) {
      throw new Error("OpenAIEmbedder: apiKey is required");
    }
    this.client = client ?? new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  async embed(text: string): Promise<number[]> {
    if (typeof text !== "string" || text.length === 0) {
      throw new Error("OpenAIEmbedder.embed: text must be a non-empty string");
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });

    const firstResult = response.data[0];
    if (!firstResult || !Array.isArray(firstResult.embedding)) {
      throw new Error("OpenAIEmbedder.embed: no embedding returned from API");
    }

    return firstResult.embedding;
  }
}
