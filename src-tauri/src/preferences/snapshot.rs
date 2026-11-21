use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_SNAPSHOT_BYTES: usize = 256 * 1024;
const MAX_PROVIDERS: usize = 100;
const THEMES: &[&str] = &[
    "laurel", "ocean", "indigo", "lavender", "rose", "coral", "amber", "teal", "sky", "ruby",
    "graphite", "sand",
];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceSnapshot {
    pub schema_version: u8,
    pub preferences: SnapshotPreferences,
    pub active_provider_id: Option<String>,
    pub providers: Vec<SnapshotProvider>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotPreferences {
    pub theme_id: String,
    pub appearance: String,
    pub update_mode: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotProvider {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_endpoint: Option<String>,
}

pub fn decode(bytes: &[u8]) -> Result<PreferenceSnapshot, String> {
    if bytes.is_empty() || bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err("La configuración de sincronización está vacía o supera 256 KiB.".into());
    }
    let snapshot: PreferenceSnapshot = serde_json::from_slice(bytes)
        .map_err(|_| "La configuración de sincronización no cumple el formato v1.".to_string())?;
    validate(&snapshot)?;
    Ok(snapshot)
}

pub fn encode(snapshot: &PreferenceSnapshot) -> Result<Vec<u8>, String> {
    validate(snapshot)?;
    let bytes = serde_json::to_vec(snapshot)
        .map_err(|_| "No se pudo codificar la configuración de sincronización.".to_string())?;
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err("La configuración de sincronización supera 256 KiB.".into());
    }
    Ok(bytes)
}

fn validate(snapshot: &PreferenceSnapshot) -> Result<(), String> {
    if snapshot.schema_version != 1 {
        return Err("La versión del snapshot de sincronización no es compatible.".into());
    }
    if !THEMES.contains(&snapshot.preferences.theme_id.as_str())
        || !matches!(snapshot.preferences.appearance.as_str(), "dark" | "light")
        || !matches!(
            snapshot.preferences.update_mode.as_str(),
            "manual" | "automatic"
        )
    {
        return Err("Las preferencias del snapshot no son válidas.".into());
    }
    if snapshot.providers.len() > MAX_PROVIDERS {
        return Err("El snapshot contiene más de 100 perfiles.".into());
    }

    let mut ids = HashSet::with_capacity(snapshot.providers.len());
    for provider in &snapshot.providers {
        if provider.id.trim().is_empty()
            || provider.id.len() > 64
            || provider.id.chars().any(char::is_control)
            || !matches!(
                provider.kind.as_str(),
                "freellmapi" | "ollama" | "lmstudio" | "custom"
            )
            || provider.name.trim().is_empty()
            || provider.name.len() > 128
            || provider.model.trim().is_empty()
            || provider.model.len() > 256
            || provider
                .custom_endpoint
                .as_ref()
                .is_some_and(|endpoint| crate::providers::validate_base_url(endpoint).is_err())
            || !ids.insert(provider.id.as_str())
        {
            return Err("Un perfil del snapshot está incompleto o duplicado.".into());
        }
    }
    if snapshot
        .active_provider_id
        .as_deref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("El proveedor activo no aparece en el snapshot.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        include_bytes!("../../../shared/fixtures/preference-snapshot-v1.json").to_vec()
    }

    #[test]
    fn acepta_fixture_compartida_y_la_codifica_sin_cambios() {
        let bytes = fixture();
        let decoded = decode(&bytes).unwrap();
        let encoded = encode(&decoded).unwrap();
        let roundtrip = decode(&encoded).unwrap();

        assert_eq!(roundtrip, decoded);
        assert_eq!(roundtrip.providers.len(), 2);
        assert_eq!(roundtrip.providers[0].custom_endpoint, None);
        assert_eq!(
            roundtrip.providers[1].custom_endpoint.as_deref(),
            Some("https://llm.example/v1")
        );
    }

    #[test]
    fn rechaza_secretos_campos_desconocidos_y_versiones_futuras() {
        let mut with_secret: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        with_secret["providers"][0]["apiKey"] = "no-debe-entrar".into();
        assert!(decode(&serde_json::to_vec(&with_secret).unwrap()).is_err());

        let mut future: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        future["schemaVersion"] = 2.into();
        assert!(decode(&serde_json::to_vec(&future).unwrap()).is_err());
    }

    #[test]
    fn rechaza_duplicados_proveedor_activo_invalido_y_limites() {
        let mut duplicate: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        duplicate["providers"][1]["id"] = "local-ollama".into();
        assert!(decode(&serde_json::to_vec(&duplicate).unwrap()).is_err());

        let mut invalid_active: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        invalid_active["activeProviderId"] = "missing".into();
        assert!(decode(&serde_json::to_vec(&invalid_active).unwrap()).is_err());

        assert!(decode(&vec![b' '; MAX_SNAPSHOT_BYTES + 1]).is_err());
        assert!(decode(b" ").is_err());

        let mut remote_http: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        remote_http["providers"][1]["customEndpoint"] = "http://llm.example/v1".into();
        assert!(decode(&serde_json::to_vec(&remote_http).unwrap()).is_err());

        let mut local_http: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        local_http["providers"][1]["customEndpoint"] = "http://127.0.0.1:1234/v1".into();
        assert!(decode(&serde_json::to_vec(&local_http).unwrap()).is_ok());
    }
}
