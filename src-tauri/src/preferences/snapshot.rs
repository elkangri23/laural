use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_SNAPSHOT_BYTES: usize = 256 * 1024;
const MAX_PROVIDERS: usize = 100;
const LANGUAGES: &[&str] = &["es", "en"];
const THEMES: &[&str] = &[
    "laurel", "ocean", "indigo", "lavender", "rose", "coral", "amber", "teal", "sky", "ruby",
    "graphite", "sand",
];
const APPEARANCES: &[&str] = &["dark", "light"];
const UPDATE_MODES: &[&str] = &["manual", "automatic"];
const PROVIDER_KINDS: &[&str] = &["freellmapi", "ollama", "lmstudio", "custom"];

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
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
    let snapshot: PreferenceSnapshot = serde_json::from_slice(bytes).map_err(|_| {
        "La configuración de sincronización no cumple el formato v1 o v2.".to_string()
    })?;
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

/// Dos snapshots son el mismo ajuste aunque uno sea v1 y el otro v2: la v1
/// no tiene idioma porque entonces no se sincronizaba, y la versión del
/// esquema no es un ajuste en sí. Sin esta equivalencia, un snapshot v1 en
/// la nube nunca coincide con el snapshot v2 local y cada comparación dice
/// que difieren, aunque nada haya cambiado (la descarga vuelve a dejarlo
/// todo igual y la siguiente comparación vuelve a decir que difiere).
pub fn snapshots_equivalent(left: &PreferenceSnapshot, right: &PreferenceSnapshot) -> bool {
    if left.preferences.theme_id != right.preferences.theme_id
        || left.preferences.appearance != right.preferences.appearance
        || left.preferences.update_mode != right.preferences.update_mode
        || left.active_provider_id != right.active_provider_id
    {
        return false;
    }
    if let (Some(left_language), Some(right_language)) = (
        left.preferences.language.as_deref(),
        right.preferences.language.as_deref(),
    ) {
        if left_language != right_language {
            return false;
        }
    }
    let mut left_providers = left.providers.clone();
    let mut right_providers = right.providers.clone();
    left_providers.sort_by(|left, right| left.id.cmp(&right.id));
    right_providers.sort_by(|left, right| left.id.cmp(&right.id));
    left_providers == right_providers
}

fn validate(snapshot: &PreferenceSnapshot) -> Result<(), String> {
    if !matches!(snapshot.schema_version, 1 | 2) {
        return Err("La versión del snapshot de sincronización no es compatible.".into());
    }
    if !THEMES.contains(&snapshot.preferences.theme_id.as_str())
        || !APPEARANCES.contains(&snapshot.preferences.appearance.as_str())
        || !UPDATE_MODES.contains(&snapshot.preferences.update_mode.as_str())
    {
        return Err("Las preferencias del snapshot no son válidas.".into());
    }
    match (
        snapshot.schema_version,
        snapshot.preferences.language.as_deref(),
    ) {
        (1, None) => {}
        (2, Some(language)) if LANGUAGES.contains(&language) => {}
        _ => return Err("El idioma del snapshot de sincronización no es válido.".into()),
    }
    if snapshot.providers.len() > MAX_PROVIDERS {
        return Err("El snapshot contiene más de 100 perfiles.".into());
    }

    let mut ids = HashSet::with_capacity(snapshot.providers.len());
    for provider in &snapshot.providers {
        if provider.id.trim().is_empty()
            || provider.id.len() > 64
            || provider.id.chars().any(char::is_control)
            || !PROVIDER_KINDS.contains(&provider.kind.as_str())
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
    fn enumeraciones_canonicas_coinciden_con_los_valores_aceptados_por_rust() {
        let schema: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../shared/preference-snapshot-v1.schema.json"
        ))
        .unwrap();

        for (schema_values, rust_values) in [
            (
                schema["properties"]["preferences"]["properties"]["themeId"]["enum"]
                    .as_array()
                    .unwrap(),
                THEMES,
            ),
            (
                schema["properties"]["preferences"]["properties"]["appearance"]["enum"]
                    .as_array()
                    .unwrap(),
                APPEARANCES,
            ),
            (
                schema["properties"]["preferences"]["properties"]["updateMode"]["enum"]
                    .as_array()
                    .unwrap(),
                UPDATE_MODES,
            ),
            (
                schema["properties"]["providers"]["items"]["properties"]["kind"]["enum"]
                    .as_array()
                    .unwrap(),
                PROVIDER_KINDS,
            ),
        ] {
            let schema_values: Vec<_> = schema_values
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(schema_values, rust_values);
        }

        for field in ["themeId", "appearance", "updateMode"] {
            let values = schema["properties"]["preferences"]["properties"][field]["enum"]
                .as_array()
                .unwrap();
            for value in values {
                let mut instance: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
                instance["preferences"][field] = value.clone();
                assert!(decode(&serde_json::to_vec(&instance).unwrap()).is_ok());
            }
        }

        let provider_kinds =
            schema["properties"]["providers"]["items"]["properties"]["kind"]["enum"]
                .as_array()
                .unwrap();
        for kind in provider_kinds {
            let mut instance: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
            instance["providers"][0]["kind"] = kind.clone();
            assert!(decode(&serde_json::to_vec(&instance).unwrap()).is_ok());
        }
    }

    #[test]
    fn rust_rechaza_secretos_y_enumeraciones_fuera_del_schema_canonico() {
        let mut instances: Vec<serde_json::Value> = Vec::new();
        let mut secret: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        secret["providers"][0]["apiKey"] = "secreto".into();
        instances.push(secret);
        let mut invalid_appearance: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        invalid_appearance["preferences"]["appearance"] = "system".into();
        instances.push(invalid_appearance);
        let mut invalid_kind: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        invalid_kind["providers"][0]["kind"] = "provider-desconocido".into();
        instances.push(invalid_kind);

        for instance in instances {
            assert!(decode(&serde_json::to_vec(&instance).unwrap()).is_err());
        }

        for (field, value) in [
            ("themeId", serde_json::json!("tema-inexistente")),
            ("appearance", serde_json::json!("system")),
            ("updateMode", serde_json::json!("always")),
        ] {
            let mut instance: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
            instance["preferences"][field] = value;
            assert!(decode(&serde_json::to_vec(&instance).unwrap()).is_err());
        }

        let mut invalid_provider_kind: serde_json::Value =
            serde_json::from_slice(&fixture()).unwrap();
        invalid_provider_kind["providers"][0]["kind"] = "provider-desconocido".into();
        assert!(decode(&serde_json::to_vec(&invalid_provider_kind).unwrap()).is_err());
    }

    #[test]
    fn rechaza_secretos_campos_desconocidos_y_versiones_futuras() {
        let mut with_secret: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        with_secret["providers"][0]["apiKey"] = "no-debe-entrar".into();
        assert!(decode(&serde_json::to_vec(&with_secret).unwrap()).is_err());

        let mut future: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        future["schemaVersion"] = 3.into();
        assert!(decode(&serde_json::to_vec(&future).unwrap()).is_err());
    }

    #[test]
    fn rechaza_entrada_vacia_y_no_codifica_versiones_futuras() {
        assert!(decode(b"").is_err());

        let mut future: PreferenceSnapshot = serde_json::from_slice(&fixture()).unwrap();
        future.schema_version = 3;
        assert!(encode(&future).is_err());
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

    #[test]
    fn valida_limites_de_perfiles_y_campos_individuales() {
        let mut at_limits: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        at_limits["providers"][0]["id"] = "i".repeat(64).into();
        at_limits["providers"][0]["name"] = "n".repeat(128).into();
        at_limits["providers"][0]["model"] = "m".repeat(256).into();
        at_limits["activeProviderId"] = "i".repeat(64).into();
        assert!(decode(&serde_json::to_vec(&at_limits).unwrap()).is_ok());

        for (field, invalid_value) in [
            ("id", " ".to_string()),
            ("id", "i".repeat(65)),
            ("id", "id\ncontrol".to_string()),
            ("kind", "desconocido".to_string()),
            ("name", "\t".to_string()),
            ("name", "n".repeat(129)),
            ("model", " ".to_string()),
            ("model", "m".repeat(257)),
            (
                "customEndpoint",
                "https://user:pass@example.org".to_string(),
            ),
        ] {
            let mut instance: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
            instance["providers"][0][field] = invalid_value.into();
            assert!(
                decode(&serde_json::to_vec(&instance).unwrap()).is_err(),
                "{field}"
            );
        }

        let mut exactly_max_providers: serde_json::Value =
            serde_json::from_slice(&fixture()).unwrap();
        let provider = exactly_max_providers["providers"][0].clone();
        for index in 2..MAX_PROVIDERS {
            let mut next = provider.clone();
            next["id"] = format!("perfil-{index}").into();
            exactly_max_providers["providers"]
                .as_array_mut()
                .unwrap()
                .push(next);
        }
        assert_eq!(
            decode(&serde_json::to_vec(&exactly_max_providers).unwrap())
                .unwrap()
                .providers
                .len(),
            MAX_PROVIDERS
        );
        exactly_max_providers["providers"]
            .as_array_mut()
            .unwrap()
            .push(provider);
        assert!(decode(&serde_json::to_vec(&exactly_max_providers).unwrap()).is_err());
    }

    #[test]
    fn acepta_snapshot_del_tamano_maximo_y_proveedor_activo_ausente() {
        let mut value: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        value["activeProviderId"] = serde_json::Value::Null;
        let mut bytes = serde_json::to_vec(&value).unwrap();
        bytes.resize(MAX_SNAPSHOT_BYTES, b' ');

        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.active_provider_id, None);
        assert_eq!(
            encode(&decoded).unwrap().len(),
            serde_json::to_vec(&value).unwrap().len()
        );
    }

    #[test]
    fn valida_snapshot_v2_y_acepta_solo_es_o_en() {
        let schema: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../shared/preference-snapshot-v2.schema.json"
        ))
        .unwrap();
        let languages = schema["properties"]["preferences"]["properties"]["language"]["enum"]
            .as_array()
            .unwrap();

        for language in languages {
            let mut value: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
            value["schemaVersion"] = 2.into();
            value["preferences"]["language"] = language.clone();
            let decoded = decode(&serde_json::to_vec(&value).unwrap()).unwrap();
            assert_eq!(decoded.schema_version, 2);
            assert_eq!(decoded.preferences.language.as_deref(), language.as_str());
        }

        let mut unsupported: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        unsupported["schemaVersion"] = 2.into();
        unsupported["preferences"]["language"] = "fr".into();
        assert!(decode(&serde_json::to_vec(&unsupported).unwrap()).is_err());

        let mut missing: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        missing["schemaVersion"] = 2.into();
        assert!(decode(&serde_json::to_vec(&missing).unwrap()).is_err());
    }

    #[test]
    fn v1_y_v2_con_los_mismos_ajustes_son_equivalentes() {
        let v1: PreferenceSnapshot = serde_json::from_slice(&fixture()).unwrap();
        assert_eq!(v1.schema_version, 1);
        assert_eq!(v1.preferences.language, None);
        let mut v2 = v1.clone();
        v2.schema_version = 2;
        v2.preferences.language = Some("es".into());
        assert!(snapshots_equivalent(&v1, &v2));
        assert!(snapshots_equivalent(&v2, &v1));

        let mut other_language = v2.clone();
        other_language.preferences.language = Some("en".into());
        assert!(!snapshots_equivalent(&v2, &other_language));

        let mut other_theme = v2.clone();
        other_theme.preferences.theme_id = "indigo".into();
        assert!(!snapshots_equivalent(&v1, &other_theme));

        let mut other_endpoint = v2.clone();
        other_endpoint.providers[1].custom_endpoint = None;
        assert!(!snapshots_equivalent(&v1, &other_endpoint));

        let mut shuffled = v2.clone();
        shuffled.providers.reverse();
        assert!(snapshots_equivalent(&v1, &shuffled));
    }

    #[test]
    fn v1_conserva_formato_y_rechaza_idioma_inesperado() {
        let mut legacy: serde_json::Value = serde_json::from_slice(&fixture()).unwrap();
        let decoded = decode(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(decoded.schema_version, 1);
        assert_eq!(decoded.preferences.language, None);

        legacy["preferences"]["language"] = "es".into();
        assert!(decode(&serde_json::to_vec(&legacy).unwrap()).is_err());
    }
}
