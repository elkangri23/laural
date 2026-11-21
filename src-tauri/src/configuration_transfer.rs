use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const FORMAT: &str = "laural-configuration";
const VERSION: u32 = 1;
const MAX_FILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROVIDERS: usize = 100;
const MAX_PASSWORD_BYTES: usize = 1024;
const ALLOWED_THEMES: &[&str] = &[
    "laurel", "ocean", "indigo", "lavender", "rose", "coral", "amber", "teal", "sky", "ruby",
    "graphite", "sand",
];
const SALT_BYTES: usize = 16;
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const AAD: &[u8] = b"laural-configuration/1/encrypted-keys";
const KDF_ID: &str = "argon2id-v=19,m=19456,t=2,p=1";

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TransferPreferences {
    pub theme_id: String,
    pub appearance: String,
    pub update_mode: String,
}

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TransferProvider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
}

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TransferData {
    pub preferences: TransferPreferences,
    pub active_provider_id: Option<String>,
    pub providers: Vec<TransferProvider>,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApiKeyEntry {
    pub provider_id: String,
    pub api_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedData {
    data: TransferData,
    api_keys: Vec<ApiKeyEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EncryptedPayload {
    algorithm: String,
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExportFile {
    format: String,
    version: u32,
    exported_at: u64,
    mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    data: Option<TransferData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    encrypted: Option<EncryptedPayload>,
}

pub(crate) struct DecodedExport {
    pub data: TransferData,
    pub api_keys: Vec<ApiKeyEntry>,
    pub encrypted: bool,
    pub contains_api_keys: bool,
}

pub(crate) fn encode(
    data: TransferData,
    api_keys: Vec<ApiKeyEntry>,
    password: Option<&str>,
) -> Result<Vec<u8>, String> {
    validate_data(&data, &api_keys)?;
    let exported_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "No se pudo obtener la fecha de exportación.".to_string())?
        .as_secs();

    let file = if api_keys.is_empty() && password.is_none() {
        ExportFile {
            format: FORMAT.into(),
            version: VERSION,
            exported_at,
            mode: "plain".into(),
            data: Some(data),
            encrypted: None,
        }
    } else {
        let password = password.ok_or_else(|| {
            "Establece una contraseña para proteger las claves exportadas.".to_string()
        })?;
        validate_password(password)?;
        let encrypted_data = EncryptedData { data, api_keys };
        let plaintext = Zeroizing::new(
            serde_json::to_vec(&encrypted_data)
                .map_err(|_| "No se pudo preparar la exportación protegida.".to_string())?,
        );
        let mut salt = [0_u8; SALT_BYTES];
        getrandom::fill(&mut salt)
            .map_err(|_| "No se pudo generar sal criptográfica.".to_string())?;
        let mut nonce_bytes = [0_u8; NONCE_BYTES];
        getrandom::fill(&mut nonce_bytes)
            .map_err(|_| "No se pudo generar un nonce criptográfico.".to_string())?;
        let key = derive_key(password, &salt)?;
        let cipher = Aes256Gcm::new_from_slice(&key[..])
            .map_err(|_| "No se pudo inicializar el cifrado.".to_string())?;
        let nonce = Nonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext.as_slice(),
                    aad: AAD,
                },
            )
            .map_err(|_| "No se pudo cifrar la exportación.".to_string())?;
        ExportFile {
            format: FORMAT.into(),
            version: VERSION,
            exported_at,
            mode: "encrypted".into(),
            data: None,
            encrypted: Some(EncryptedPayload {
                algorithm: "aes-256-gcm".into(),
                kdf: KDF_ID.into(),
                salt: BASE64.encode(salt),
                nonce: BASE64.encode(nonce_bytes),
                ciphertext: BASE64.encode(ciphertext),
            }),
        }
    };

    let bytes = serde_json::to_vec_pretty(&file)
        .map_err(|_| "No se pudo crear el archivo de exportación.".to_string())?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err("La configuración supera el tamaño máximo de exportación.".into());
    }
    Ok(bytes)
}

pub(crate) fn decode(bytes: &[u8], password: Option<&str>) -> Result<DecodedExport, String> {
    if bytes.is_empty() || bytes.len() > MAX_FILE_BYTES {
        return Err("El archivo está vacío o supera el límite de 4 MiB.".into());
    }
    let file: ExportFile = serde_json::from_slice(bytes)
        .map_err(|_| "El archivo no es una exportación válida de Laural.".to_string())?;
    if file.format != FORMAT || file.version != VERSION {
        return Err("El formato o la versión del archivo no son compatibles.".into());
    }

    let (data, api_keys, encrypted) = match (file.mode.as_str(), file.data, file.encrypted) {
        ("plain", Some(data), None) => (data, Vec::new(), false),
        ("encrypted", None, Some(encrypted)) => {
            let password = password
                .ok_or_else(|| "Introduce la contraseña del archivo para continuar.".to_string())?;
            validate_password(password)?;
            if encrypted.algorithm != "aes-256-gcm" || encrypted.kdf != KDF_ID {
                return Err("El cifrado o los parámetros del archivo no son compatibles.".into());
            }
            let salt = decode_fixed::<SALT_BYTES>(&encrypted.salt, "sal")?;
            let nonce_bytes = decode_fixed::<NONCE_BYTES>(&encrypted.nonce, "nonce")?;
            let ciphertext = BASE64
                .decode(encrypted.ciphertext)
                .map_err(|_| "El contenido cifrado del archivo no es válido.".to_string())?;
            if ciphertext.len() > MAX_FILE_BYTES {
                return Err("El contenido cifrado supera el límite permitido.".into());
            }
            let key = derive_key(password, &salt)?;
            let cipher = Aes256Gcm::new_from_slice(&key[..])
                .map_err(|_| "No se pudo inicializar el descifrado.".to_string())?;
            let nonce = Nonce::from(nonce_bytes);
            let plaintext = Zeroizing::new(
                cipher
                    .decrypt(
                        &nonce,
                        Payload {
                            msg: ciphertext.as_slice(),
                            aad: AAD,
                        },
                    )
                    .map_err(|_| {
                        "La contraseña es incorrecta o el archivo fue alterado.".to_string()
                    })?,
            );
            let encrypted_data: EncryptedData = serde_json::from_slice(plaintext.as_slice())
                .map_err(|_| "El contenido descifrado no tiene un formato válido.".to_string())?;
            (encrypted_data.data, encrypted_data.api_keys, true)
        }
        _ => return Err("El archivo contiene secciones incompatibles o incompletas.".into()),
    };
    validate_data(&data, &api_keys)?;
    Ok(DecodedExport {
        data,
        contains_api_keys: !api_keys.is_empty(),
        api_keys,
        encrypted,
    })
}

fn derive_key(
    password: &str,
    salt: &[u8; SALT_BYTES],
) -> Result<Zeroizing<[u8; KEY_BYTES]>, String> {
    let params = Params::new(19 * 1024, 2, 1, Some(KEY_BYTES))
        .map_err(|_| "No se pudieron validar los parámetros de cifrado.".to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
    argon
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "No se pudo derivar la clave del archivo.".to_string())?;
    Ok(key)
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.trim().chars().count() < 12 || password.len() > MAX_PASSWORD_BYTES {
        return Err("La contraseña debe tener al menos 12 caracteres y no superar 1 KiB.".into());
    }
    Ok(())
}

fn decode_fixed<const N: usize>(value: &str, label: &str) -> Result<[u8; N], String> {
    let bytes = BASE64
        .decode(value)
        .map_err(|_| format!("La {label} cifrada no es válida."))?;
    bytes
        .try_into()
        .map_err(|_| format!("La longitud de la {label} cifrada no es válida."))
}

fn validate_data(data: &TransferData, api_keys: &[ApiKeyEntry]) -> Result<(), String> {
    if data.providers.len() > MAX_PROVIDERS {
        return Err("El archivo contiene más de 100 perfiles de proveedor.".into());
    }
    if !ALLOWED_THEMES.contains(&data.preferences.theme_id.as_str())
        || !matches!(data.preferences.appearance.as_str(), "dark" | "light")
        || !matches!(
            data.preferences.update_mode.as_str(),
            "manual" | "automatic"
        )
    {
        return Err("Las preferencias de apariencia o actualización no son válidas.".into());
    }

    let mut ids = std::collections::HashSet::with_capacity(data.providers.len());
    for provider in &data.providers {
        if provider.id.trim().is_empty()
            || provider.id.len() > 64
            || provider.id.chars().any(char::is_control)
            || provider.name.trim().is_empty()
            || provider.name.len() > 128
            || provider.model.trim().is_empty()
            || provider.model.len() > 256
            || provider.base_url.trim().is_empty()
            || provider.base_url.len() > 2_048
            || !ids.insert(provider.id.as_str())
        {
            return Err("Un perfil de proveedor está incompleto o duplicado.".into());
        }
    }
    if data
        .active_provider_id
        .as_deref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("El proveedor activo no aparece en el archivo.".into());
    }

    let mut key_ids = std::collections::HashSet::with_capacity(api_keys.len());
    for key in api_keys {
        if key.api_key.trim().is_empty()
            || key.api_key.len() > 16_384
            || !ids.contains(key.provider_id.as_str())
            || !key_ids.insert(key.provider_id.as_str())
        {
            return Err(
                "El archivo contiene una clave vacía, excesiva, duplicada o sin perfil.".into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (TransferData, Vec<ApiKeyEntry>) {
        (
            TransferData {
                preferences: TransferPreferences {
                    theme_id: "laurel".into(),
                    appearance: "dark".into(),
                    update_mode: "manual".into(),
                },
                active_provider_id: Some("provider-1".into()),
                providers: vec![TransferProvider {
                    id: "provider-1".into(),
                    name: "Local".into(),
                    base_url: "http://127.0.0.1:11434/v1".into(),
                    model: "qwen".into(),
                }],
            },
            vec![ApiKeyEntry {
                provider_id: "provider-1".into(),
                api_key: "secret-key".into(),
            }],
        )
    }

    #[test]
    fn exportacion_sin_claves_es_legible_y_no_incluye_secretos() {
        let (data, _) = sample();
        let bytes = encode(data, Vec::new(), None).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(text.contains("laural-configuration"));
        assert!(!text.contains("secret-key"));
        assert!(!text.contains("apiKey"));
        let decoded = decode(&bytes, None).unwrap();
        assert!(!decoded.encrypted);
        assert!(!decoded.contains_api_keys);
        assert!(decoded.api_keys.is_empty());
    }

    #[test]
    fn exportacion_cifrada_recupera_configuracion_y_clave() {
        let (data, keys) = sample();
        assert!(encode(data.clone(), keys, None).is_err());
        let (_, keys) = sample();
        let bytes = encode(data, keys, Some("clave segura de prueba")).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(!text.contains("secret-key"));
        let decoded = decode(&bytes, Some("clave segura de prueba")).unwrap();
        assert!(decoded.encrypted);
        assert!(decoded.contains_api_keys);
        assert_eq!(decoded.api_keys[0].api_key, "secret-key");
        assert_eq!(decoded.data.providers[0].name, "Local");
    }

    #[test]
    fn exportacion_cifrada_sigue_protegida_aunque_no_haya_claves() {
        let (data, _) = sample();
        let bytes = encode(data, Vec::new(), Some("clave segura de prueba")).unwrap();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert!(text.contains("\"mode\": \"encrypted\""));
        assert!(decode(&bytes, None).is_err());
        let decoded = decode(&bytes, Some("clave segura de prueba")).unwrap();
        assert!(decoded.encrypted);
        assert!(!decoded.contains_api_keys);
    }

    #[test]
    fn rechaza_contrasena_incorrecta_y_alteracion() {
        let (data, keys) = sample();
        let bytes = encode(data, keys, Some("clave segura de prueba")).unwrap();
        assert!(decode(&bytes, Some("otra clave segura")).is_err());
        let mut altered = bytes;
        let position = altered.len() - 8;
        altered[position] ^= 1;
        assert!(decode(&altered, Some("clave segura de prueba")).is_err());
    }

    #[test]
    fn rechaza_password_corto_datos_duplicados_y_archivos_excesivos() {
        let (data, _keys) = sample();
        assert!(
            encode(
                data.clone(),
                vec![ApiKeyEntry {
                    provider_id: "provider-1".into(),
                    api_key: "secret-key".into(),
                }],
                Some("corta"),
            )
            .is_err()
        );
        let mut duplicate = data;
        duplicate.providers.push(duplicate.providers[0].clone());
        assert!(validate_data(&duplicate, &[]).is_err());
        assert!(decode(&vec![b'a'; MAX_FILE_BYTES + 1], None).is_err());
        let mut unsupported_theme = sample().0;
        unsupported_theme.preferences.theme_id = "unknown".into();
        assert!(validate_data(&unsupported_theme, &[]).is_err());
    }
}
