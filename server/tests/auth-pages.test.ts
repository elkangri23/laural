import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderAccountRecoveryPage,
  renderLoginPage,
  renderMfaPage,
  renderPasswordResetPage,
  renderRecoveryPage,
  renderRegisterPage,
  renderVerificationPage,
} from "../src/auth-pages.js";

describe("páginas críticas de acceso", () => {
  it("escapa todos los caracteres HTML especiales", () => {
    expect(escapeHtml(`<tag attr="'&>`)).toBe("&lt;tag attr=&quot;&#39;&amp;&gt;");
    expect(escapeHtml("texto seguro")).toBe("texto seguro");
  });

  it("renderiza login con las opciones habilitadas y deshabilitadas", () => {
    const disabled = renderLoginPage("csrf", "aviso");
    expect(disabled).toContain('action="/auth/native/login"');
    expect(disabled).not.toContain("data-passkey-login");
    expect(disabled).not.toContain("Continuar con Google");
    expect(disabled).not.toContain("/auth/native/recovery?csrf=");
    expect(disabled).not.toContain("/auth/passkeys.js");

    const enabled = renderLoginPage(`<script>&"'`, "<aviso>", true, true, true);
    expect(enabled).toContain("&lt;script&gt;&amp;&quot;&#39;");
    expect(enabled).toContain("&lt;aviso&gt;");
    expect(enabled).toContain("data-passkey-login");
    expect(enabled).toContain("/auth/passkeys.js");
    expect(enabled).toContain("Continuar con Google");
    expect(enabled).toContain("/auth/native/recovery?csrf=");
  });

  it("renderiza registro y verificación con CSRF y avisos escapados", () => {
    const register = renderRegisterPage("<csrf>", "<aviso>");
    expect(register).toContain('action="/auth/native/register"');
    expect(register).toContain("&lt;csrf&gt;");
    expect(register).toContain("&lt;aviso&gt;");

    const verification = renderVerificationPage("csrf", "aviso");
    expect(verification).toContain('action="/auth/native/verification/confirm"');
    expect(verification).toContain('action="/auth/native/verification/resend"');
    expect(verification).toContain("No inicia sesión ni elimina passkeys o MFA");
  });

  it("renderiza restablecimiento y recuperación sin dar acceso a la cuenta", () => {
    const reset = renderPasswordResetPage("csrf", "aviso");
    expect(reset).toContain('action="/auth/native/password-reset/request"');
    expect(reset).toContain('action="/auth/native/password-reset/confirm"');
    expect(reset).toContain("no inicia sesión ni elimina passkeys o MFA");

    const recovery = renderRecoveryPage("csrf", "aviso");
    expect(recovery).toContain('action="/auth/native/recovery/request"');
    expect(recovery).toContain('action="/auth/native/recovery/confirm"');
    expect(recovery).toContain("no crea una sesión ni elimina factores");
  });

  it("escapa los datos de identidad de MFA y muestra el enrolamiento recuperado", () => {
    const mfa = renderMfaPage(`<csrf>`, `user"@example.test`, `<notice>`);
    expect(mfa).toContain("&lt;csrf&gt;");
    expect(mfa).toContain("user&quot;@example.test");
    expect(mfa).toContain("&lt;notice&gt;");
    expect(mfa).toContain('action="/auth/native/login/mfa"');

    const recovery = renderAccountRecoveryPage();
    expect(recovery).toContain("data-recovery-enrollment");
    expect(recovery).toContain("data-recovery-codes");
    expect(recovery).toContain("/auth/recovery.js");
  });
});
