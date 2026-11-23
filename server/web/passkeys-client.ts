import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

const csrf = document.querySelector<HTMLInputElement>("[name=csrf]")?.value ?? "";
const notice = document.querySelector<HTMLElement>("[data-passkey-notice]");

async function request<T>(path: string, method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("request_failed");
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

if (!csrf) {
  const bootstrapNotice = document.querySelector<HTMLElement>("[data-passkey-bootstrap-notice]");
  const ticket = new URLSearchParams(window.location.hash.slice(1)).get("ticket");
  if (ticket) {
    void fetch("/auth/passkeys/manage/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error("ticket_expired");
      history.replaceState(null, "", window.location.pathname);
      window.location.reload();
    }).catch(() => {
      history.replaceState(null, "", window.location.pathname);
      bootstrapNotice && (bootstrapNotice.textContent = "El enlace caducó o ya se utilizó. Vuelve a Laural para generar uno nuevo.");
    });
  } else {
    bootstrapNotice && (bootstrapNotice.textContent = "Abre esta sección desde Laural. Los enlaces solo se pueden utilizar una vez.");
  }
}

const loginButton = document.querySelector<HTMLButtonElement>("[data-passkey-login]");
loginButton?.addEventListener("click", async () => {
  loginButton.disabled = true;
  try {
    const options = await request<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/native/passkey/options", "POST", { csrf });
    const assertion = await startAuthentication({ optionsJSON: options });
    const result = await request<{ redirect?: string; mfaRequired?: boolean; email?: string }>("/auth/native/passkey/verify", "POST", { csrf, response: assertion });
    if (result.redirect) {
      window.location.assign(result.redirect);
      return;
    }
    if (result.mfaRequired && result.email) {
      const form = document.querySelector<HTMLFormElement>("[data-passkey-mfa]");
      if (form) {
        form.hidden = false;
        form.querySelector<HTMLInputElement>("[name=email]")!.value = result.email;
        form.querySelector<HTMLInputElement>("[name=proof]")?.focus();
        notice && (notice.textContent = "Confirma el código TOTP de tu cuenta para continuar.");
      }
      return;
    }
    throw new Error("passkey_failed");
  } catch {
    notice && (notice.textContent = "No se pudo iniciar sesión con esa passkey. Comprueba el método o vuelve a intentarlo.");
  } finally {
    loginButton.disabled = false;
  }
});

const management = document.querySelector<HTMLElement>("[data-passkey-management]");
const nameInput = document.querySelector<HTMLInputElement>("[data-passkey-name]");
const list = document.querySelector<HTMLElement>("[data-passkey-list]");
const managementNotice = document.querySelector<HTMLElement>("[data-passkey-management-notice]");

async function loadPasskeys(): Promise<void> {
  if (!list) return;
  const passkeys = await request<Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>>("/auth/passkeys/manage/list", "GET");
  list.replaceChildren();
  if (passkeys.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "Aún no hay passkeys en esta cuenta.";
    list.append(empty);
    return;
  }
  for (const passkey of passkeys) {
    const row = document.createElement("div");
    row.className = "passkey-row";
    const label = document.createElement("span");
    label.textContent = `${passkey.name} · añadida ${new Date(passkey.createdAt).toLocaleDateString("es-ES")}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Eliminar";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await request(`/auth/passkeys/manage/${encodeURIComponent(passkey.id)}`, "DELETE");
        await loadPasskeys();
      } catch {
        managementNotice && (managementNotice.textContent = "No se pudo eliminar la passkey.");
        remove.disabled = false;
      }
    });
    row.append(label, remove);
    list.append(row);
  }
}

if (management) {
  void loadPasskeys().catch(() => {
    managementNotice && (managementNotice.textContent = "La sesión de gestión caducó. Vuelve a abrir esta sección desde Laural.");
  });
  management.querySelector<HTMLButtonElement>("[data-passkey-create]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const displayName = nameInput?.value.trim() ?? "";
    button.disabled = true;
    try {
      const options = await request<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkeys/manage/options", "POST", { csrf, displayName });
      const registration = await startRegistration({ optionsJSON: options });
      await request("/auth/passkeys/manage/register", "POST", { csrf, response: registration });
      if (nameInput) nameInput.value = "";
      managementNotice && (managementNotice.textContent = "Passkey añadida a la cuenta.");
      await loadPasskeys();
    } catch {
      managementNotice && (managementNotice.textContent = "No se pudo añadir la passkey. Si la solicitud caducó, vuelve a intentarlo.");
    } finally {
      button.disabled = false;
    }
  });
}
