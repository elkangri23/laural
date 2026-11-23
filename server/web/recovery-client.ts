type Enrollment = { csrf: string; secret: string; provisioningUri: string };

const notice = document.querySelector<HTMLElement>("[data-recovery-notice]");
const enrollmentSection = document.querySelector<HTMLElement>("[data-recovery-enrollment]");
const secretElement = document.querySelector<HTMLElement>("[data-recovery-secret]");
const uriLink = document.querySelector<HTMLAnchorElement>("[data-recovery-uri]");
const form = document.querySelector<HTMLFormElement>("[data-recovery-form]");
const codeInput = document.querySelector<HTMLInputElement>("[data-recovery-code]");
const codesSection = document.querySelector<HTMLElement>("[data-recovery-codes]");
const codeList = document.querySelector<HTMLUListElement>("[data-recovery-code-list]");

let csrf: string | undefined;

void start();

async function start(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const ticket = fragment.get("ticket");
  window.history.replaceState(null, "", window.location.pathname);
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    setNotice("El enlace no es válido o ya ha caducado. Contacta con el administrador para iniciar una nueva revisión.");
    return;
  }

  try {
    const response = await fetch("/auth/recovery/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket }),
      credentials: "same-origin", cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new Error();
    const result = await response.json() as Enrollment;
    csrf = result.csrf;
    if (!/^[A-Za-z0-9_-]{43}$/.test(csrf) || !/^[A-Z2-7]{16,64}$/.test(result.secret)
      || !result.provisioningUri.startsWith("otpauth://totp/")) throw new Error();
    if (secretElement) secretElement.textContent = result.secret;
    if (uriLink) uriLink.href = result.provisioningUri;
    enrollmentSection?.removeAttribute("hidden");
    setNotice("Enlace aceptado. Añade la clave a tu aplicación autenticadora y confirma el código.");
    codeInput?.focus();
  } catch {
    setNotice("No se pudo validar el enlace. Puede haber caducado o ya haberse utilizado.");
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = codeInput?.value ?? "";
  if (!csrf || !/^[0-9]{6}$/.test(code)) {
    setNotice("Introduce el código actual de seis dígitos.");
    return;
  }
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (button) button.disabled = true;
  try {
    const response = await fetch("/auth/recovery/confirm", {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ csrf, code }), credentials: "same-origin", cache: "no-store", redirect: "error",
    });
    if (!response.ok) throw new Error();
    const result = await response.json() as { recoveryCodes: string[] };
    if (!Array.isArray(result.recoveryCodes) || result.recoveryCodes.length !== 10 || !codeList) throw new Error();
    codeList.replaceChildren(...result.recoveryCodes.map((value) => {
      const item = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = value;
      item.append(code);
      return item;
    }));
    enrollmentSection?.setAttribute("hidden", "");
    codesSection?.removeAttribute("hidden");
    setNotice("Segundo factor actualizado. Se revocaron las sesiones anteriores y no se ha iniciado una sesión nueva.");
  } catch {
    setNotice("No se pudo confirmar el código. Comprueba que la hora del dispositivo esté sincronizada y vuelve a intentarlo.");
    if (button) button.disabled = false;
    codeInput?.select();
  }
});

function setNotice(message: string): void {
  if (notice) notice.textContent = message;
}
