import { describe, expect, it } from "vitest";
import type { AgentFeature } from "@getpaseo/protocol/agent-types";

import { resolveFeatureValues } from "./feature-preferences";

describe("feature-preferences", () => {
  const features = [
    {
      type: "toggle" as const,
      id: "fast_mode",
      label: "Fast",
      value: false,
    },
    {
      type: "toggle" as const,
      id: "plan_mode",
      label: "Plan",
      value: false,
    },
  ];

  it("restores persisted values for available features", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          unknown_feature: true,
        },
        localFeatureValues: {},
      }),
    ).toEqual({
      fast_mode: true,
    });
  });

  it("prefers local values over persisted values", () => {
    expect(
      resolveFeatureValues({
        features,
        persistedFeatureValues: {
          fast_mode: true,
          plan_mode: false,
        },
        localFeatureValues: {
          fast_mode: false,
        },
      }),
    ).toEqual({
      fast_mode: false,
      plan_mode: false,
    });
  });

  it("keeps the user's native tier override available after a temporarily empty capability response", () => {
    const localFeatureValues = { service_tier: "future/priority_v7" };
    expect(
      resolveFeatureValues({ features: [], persistedFeatureValues: {}, localFeatureValues }),
    ).toEqual({});
    expect(
      resolveFeatureValues({
        features: [
          {
            type: "select",
            id: "service_tier",
            label: "Speed",
            value: "",
            options: [{ id: "", label: "Standard" }],
          },
        ],
        persistedFeatureValues: { service_tier: "" },
        localFeatureValues,
      }),
    ).toEqual({ service_tier: "future/priority_v7" });
    expect(localFeatureValues).toEqual({ service_tier: "future/priority_v7" });
  });

  it("submits the provider's legacy Fast translation without replacing explicit Speed or other defaults", () => {
    function discovered(value: string): AgentFeature[] {
      return [
        {
          type: "select",
          id: "service_tier",
          label: "Speed",
          value,
          options: [
            { id: "", label: "Standard" },
            { id: "native/fast-vNext", label: "Native Fast" },
          ],
        },
        { type: "toggle", id: "plan_mode", label: "Plan", value: false },
      ];
    }
    expect(
      resolveFeatureValues({
        features: discovered("native/fast-vNext"),
        persistedFeatureValues: { fast_mode: true },
        localFeatureValues: {},
      }),
    ).toEqual({ service_tier: "native/fast-vNext" });
    expect(
      resolveFeatureValues({
        features: discovered(""),
        persistedFeatureValues: { fast_mode: true },
        localFeatureValues: { fast_mode: false },
      }),
    ).toEqual({ service_tier: "" });
    expect(
      resolveFeatureValues({
        features: discovered("native/fast-vNext"),
        persistedFeatureValues: { fast_mode: true, service_tier: "" },
        localFeatureValues: {},
      }),
    ).toEqual({ service_tier: "" });
    expect(
      resolveFeatureValues({
        features: discovered("native/fast-vNext"),
        persistedFeatureValues: { fast_mode: true },
        localFeatureValues: { service_tier: "" },
      }),
    ).toEqual({ service_tier: "" });
    expect(
      resolveFeatureValues({
        features: discovered("native/fast-vNext"),
        persistedFeatureValues: {},
        localFeatureValues: {},
      }),
    ).toEqual({});
  });
});
