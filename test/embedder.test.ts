import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEmbeddingsCreate } = vi.hoisted(() => ({
  mockEmbeddingsCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    public readonly embeddings: { create: typeof mockEmbeddingsCreate };

    public constructor(_config: { apiKey: string }) {
      this.embeddings = { create: mockEmbeddingsCreate };
    }
  },
}));

import { OpenAIEmbedder } from "../src/embedder.js";

describe("OpenAIEmbedder (unit)", () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset();
  });

  it("throws when apiKey is missing", () => {
    expect(() => new OpenAIEmbedder({ apiKey: "" })).toThrow(
      "OpenAIEmbedder: apiKey is required",
    );
  });

  it("throws when embed receives an empty string", async () => {
    const embedder = new OpenAIEmbedder({ apiKey: "sk-test" });
    await expect(embedder.embed("")).rejects.toThrow(
      "OpenAIEmbedder.embed: text must be a non-empty string",
    );
  });

  it("passes model and dimensions to the client", async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }],
    });

    const embedder = new OpenAIEmbedder({
      apiKey: "sk-test",
      model: "text-embedding-3-small",
      dimensions: 512,
    });

    const result = await embedder.embed("hello");

    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "hello",
      dimensions: 512,
    });
    expect(result).toEqual([0.1, 0.2]);
  });

  it("returns the embedding from response.data[0].embedding", async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [1, 2, 3] }],
    });

    const embedder = new OpenAIEmbedder({ apiKey: "sk-test" });
    const result = await embedder.embed("x");

    expect(result).toEqual([1, 2, 3]);
  });

  it("uses default model text-embedding-3-large and dimensions 1536", async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0] }],
    });

    const embedder = new OpenAIEmbedder({ apiKey: "sk-test" });
    await embedder.embed("probe");

    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-large",
      input: "probe",
      dimensions: 1536,
    });
  });
});

describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAIEmbedder (live API)", () => {
  it("embeds hello world with 1536 dimensions, finite values, and token ceiling", async () => {
    vi.resetModules();
    await vi.doUnmock("openai");

    const [{ OpenAIEmbedder }, { default: OpenAI }] = await Promise.all([
      import("../src/embedder.js"),
      import("openai"),
    ]);

    let totalTokens = 0;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY as string,
      fetch: async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const response = await fetch(input, init);
        const parsed: unknown = await response.clone().json();
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "usage" in parsed &&
          typeof (parsed as { usage?: unknown }).usage === "object" &&
          (parsed as { usage?: { total_tokens?: unknown } }).usage !== null
        ) {
          const usage = (parsed as { usage: { total_tokens?: unknown } })
            .usage;
          if (typeof usage.total_tokens === "number") {
            totalTokens = usage.total_tokens;
          }
        }
        if (totalTokens >= 100) {
          throw new Error(
            `OpenAIEmbedder live test: total_tokens ${totalTokens} exceeds safety ceiling of 100`,
          );
        }
        return response;
      },
    });

    const embedder = new OpenAIEmbedder(
      { apiKey: process.env.OPENAI_API_KEY as string },
      client,
    );

    const result = await embedder.embed("hello world");

    expect(result.length).toBe(1536);
    expect(result.every((value) => Number.isFinite(value))).toBe(true);
    expect(totalTokens).toBeGreaterThan(0);
    expect(totalTokens).toBeLessThan(100);
  });
});
