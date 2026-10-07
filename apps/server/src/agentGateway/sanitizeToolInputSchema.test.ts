import { assert, describe, it } from "@effect/vitest";

import { FALLBACK_OBJECT_DESCRIPTION, sanitizeToolInputSchema } from "./sanitizeToolInputSchema.ts";

const cloneJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe("sanitizeToolInputSchema", () => {
  it("sanitizes $refs inside arrays", () => {
    assert.deepEqual(sanitizeToolInputSchema([{ $ref: "#/$defs/JsonValue" }, { type: "string" }]), [
      { type: "object", description: FALLBACK_OBJECT_DESCRIPTION },
      { type: "string" },
    ]);
  });

  it("inlines acyclic string, array, and enum references with their true schema", () => {
    const input = {
      type: "object",
      properties: {
        nickname: { $ref: "#/$defs/Nickname" },
        tags: { $ref: "#/$defs/TagList" },
        mode: { $ref: "#/$defs/Mode", description: "Call-site description wins." },
      },
      $defs: {
        Nickname: { type: "string", minLength: 1 },
        TagList: { type: "array", items: { type: "string" } },
        Mode: {
          type: "string",
          enum: ["fast", "careful"],
          description: "Catalogue description.",
        },
      },
    };

    assert.deepEqual(sanitizeToolInputSchema(cloneJson(input)), {
      type: "object",
      properties: {
        nickname: { type: "string", minLength: 1 },
        tags: { type: "array", items: { type: "string" } },
        mode: {
          type: "string",
          enum: ["fast", "careful"],
          description: "Call-site description wins.",
        },
      },
    });
  });

  it("breaks every cycle shape but inlines the acyclic definitions beside them", () => {
    const input = {
      type: "object",
      properties: {
        payload: { $ref: "#/$defs/JsonValue" },
        label: { $ref: "#/$defs/Label" },
        wrapped: { $ref: "#/$defs/Wrapper" },
        left: { $ref: "#/$defs/Left" },
        missing: { $ref: "#/$defs/Gone" },
        external: { $ref: "https://example.com/schema.json#/$defs/Thing" },
      },
      $defs: {
        JsonValue: {
          anyOf: [
            { type: "object", additionalProperties: { $ref: "#/$defs/JsonValue" } },
            { type: "string" },
          ],
        },
        Label: { type: "string" },
        Wrapper: {
          type: "object",
          properties: { value: { $ref: "#/$defs/JsonValue" } },
        },
        Left: { type: "object", properties: { right: { $ref: "#/$defs/Right" } } },
        Right: { type: "object", properties: { left: { $ref: "#/$defs/Left" } } },
      },
    };
    const fallback = { type: "object", description: FALLBACK_OBJECT_DESCRIPTION };

    assert.deepEqual(sanitizeToolInputSchema(cloneJson(input)), {
      type: "object",
      properties: {
        payload: fallback,
        label: { type: "string" },
        wrapped: { type: "object", properties: { value: fallback } },
        left: fallback,
        missing: fallback,
        external: fallback,
      },
    });
  });
});
