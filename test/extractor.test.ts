import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockChatCompletionsCreate } = vi.hoisted(() => ({
  mockChatCompletionsCreate: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    public readonly chat: {
      completions: { create: typeof mockChatCompletionsCreate };
    };

    public constructor(_config: { apiKey: string }) {
      this.chat = { completions: { create: mockChatCompletionsCreate } };
    }
  },
}));

import { LLMExtractor } from "../src/extractor.js";

describe("LLMExtractor (unit)", () => {
  beforeEach(() => {
    mockChatCompletionsCreate.mockReset();
  });

  it("throws when apiKey is missing", () => {
    expect(() => new LLMExtractor({ apiKey: "" })).toThrow(
      "LLMExtractor: apiKey is required",
    );
  });

  it("extract() throws when turn.content is empty", async () => {
    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await expect(
      extractor.extract({ role: "user", content: "" }),
    ).rejects.toThrow(
      "LLMExtractor.extract: turn.content must be a non-empty string",
    );
  });

  it("extract() uses default model gpt-4.1-nano when config.model omitted", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: ["a"] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await extractor.extract({ role: "user", content: "hello" });

    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4.1-nano" }),
    );
  });

  it("extract() uses config.model when provided", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    await extractor.extract({ role: "user", content: "x" });

    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("extract() uses default system prompt when config.systemPrompt omitted", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await extractor.extract({ role: "user", content: "probe" });

    const call = mockChatCompletionsCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0]).toEqual({
      role: "system",
      content: expect.stringContaining("distinct, self-contained facts"),
    });
  });

  it("extract() uses custom systemPrompt when provided", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({
      apiKey: "sk-test",
      systemPrompt: "CUSTOM_EXTRACTOR_SYS_PROMPT_XYZ",
    });
    await extractor.extract({ role: "user", content: "probe" });

    const call = mockChatCompletionsCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(call.messages[0]).toEqual({
      role: "system",
      content: "CUSTOM_EXTRACTOR_SYS_PROMPT_XYZ",
    });
  });

  it("extract() passes few-shot examples as alternating user/assistant messages", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const examples = [
      {
        input: { role: "user" as const, content: "FEW_SHOT_INPUT_UNIQUE" },
        output: ["FEW_SHOT_OUTPUT_FACT"],
      },
    ];

    const extractor = new LLMExtractor({
      apiKey: "sk-test",
      examples,
    });

    await extractor.extract({ role: "assistant", content: "final turn body" });

    const call = mockChatCompletionsCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(call.messages[1]).toEqual({
      role: "user",
      content: JSON.stringify(examples[0].input),
    });
    expect(call.messages[2]).toEqual({
      role: "assistant",
      content: JSON.stringify(examples[0].output),
    });
    expect(call.messages[call.messages.length - 1]).toEqual({
      role: "user",
      content: JSON.stringify({
        role: "assistant",
        content: "final turn body",
      }),
    });
  });

  it("extract() passes zero examples when config.examples is []", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({
      apiKey: "sk-test",
      examples: [],
    });

    await extractor.extract({ role: "user", content: "only me" });

    const call = mockChatCompletionsCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(call.messages).toHaveLength(2);
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[1]).toEqual({
      role: "user",
      content: JSON.stringify({ role: "user", content: "only me" }),
    });
  });

  it("extract() returns the facts array from a well-formed JSON response", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              facts: ["one", "two"],
            }),
          },
        },
      ],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    const result = await extractor.extract({ role: "user", content: "hi" });

    expect(result).toEqual(["one", "two"]);
  });

  it("extract() throws on malformed JSON response", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: "not-json{" } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await expect(
      extractor.extract({ role: "user", content: "hi" }),
    ).rejects.toThrow("LLMExtractor.extract: response content is not valid JSON");
  });

  it("extract() throws when response JSON missing facts field", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ other: [] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await expect(
      extractor.extract({ role: "user", content: "hi" }),
    ).rejects.toThrow(
      "LLMExtractor.extract: response JSON missing string[] facts field",
    );
  });

  it("extract() throws when facts is not string[]", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [1, 2] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await expect(
      extractor.extract({ role: "user", content: "hi" }),
    ).rejects.toThrow(
      "LLMExtractor.extract: response JSON missing string[] facts field",
    );
  });

  it("extract() returns [] when the LLM returns {facts: []}", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    const result = await extractor.extract({ role: "user", content: "hi" });

    expect(result).toEqual([]);
  });

  it("passes response_format json_schema with name extracted_facts and schema", async () => {
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ facts: [] }) } }],
    });

    const extractor = new LLMExtractor({ apiKey: "sk-test" });
    await extractor.extract({ role: "user", content: "x" });

    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({
            name: "extracted_facts",
            strict: true,
            schema: expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                facts: expect.objectContaining({
                  type: "array",
                  items: { type: "string" },
                }),
              }),
              required: ["facts"],
              additionalProperties: false,
            }),
          }),
        }),
      }),
    );
  });
});

describe.skipIf(!process.env.OPENAI_API_KEY)("LLMExtractor (live API)", () => {
  it("extracts facts from a purchase statement with token ceiling", async () => {
    vi.resetModules();
    await vi.doUnmock("openai");

    const [{ LLMExtractor }, { default: OpenAI }] = await Promise.all([
      import("../src/extractor.js"),
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
        if (totalTokens >= 500) {
          throw new Error(
            `LLMExtractor live test: total_tokens ${totalTokens} exceeds safety ceiling of 500`,
          );
        }
        return response;
      },
    });

    const extractor = new LLMExtractor(
      { apiKey: process.env.OPENAI_API_KEY as string },
      client,
    );

    const result = await extractor.extract({
      role: "user",
      content:
        "I just bought a new MacBook Pro M4 and it's been great for coding",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const joined = result.join(" ").toLowerCase();
    expect(
      joined.includes("macbook") ||
        joined.includes("mac") ||
        joined.includes("computer"),
    ).toBe(true);
    expect(totalTokens).toBeGreaterThan(0);
    expect(totalTokens).toBeLessThan(500);
  });
});
