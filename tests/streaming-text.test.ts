import { describe, expect, test } from "vitest";
import { createStreamingTextBuffer } from "../src/streamingText";

describe("createStreamingTextBuffer", () => {
  test("ensambla fragmentos en orden al solicitar una instantánea", () => {
    const buffer = createStreamingTextBuffer();
    buffer.append("Hola ");
    buffer.append("🌍");
    buffer.append("!");

    expect(buffer.snapshot()).toBe("Hola 🌍!");
    expect(buffer.snapshot()).toBe("Hola 🌍!");
  });

  test("ignora fragmentos vacíos", () => {
    const buffer = createStreamingTextBuffer();
    buffer.append("");

    expect(buffer.snapshot()).toBe("");
  });

  test("conserva una respuesta extensa dividida en muchos fragmentos", () => {
    const buffer = createStreamingTextBuffer();
    const fragment = "respuesta-á🌍";
    const expected = fragment.repeat(1_500);
    for (let index = 0; index < 1_500; index += 1) buffer.append(fragment);

    expect(buffer.snapshot()).toBe(expected);
  });

  test("clear elimina contenido acumulado y fragmentos pendientes", () => {
    const buffer = createStreamingTextBuffer();
    buffer.append("anterior");
    expect(buffer.snapshot()).toBe("anterior");
    buffer.append("pendiente");
    buffer.clear();

    expect(buffer.snapshot()).toBe("");
    buffer.append("nuevo");
    expect(buffer.snapshot()).toBe("nuevo");
  });
});
