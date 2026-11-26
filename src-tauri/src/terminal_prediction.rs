const PREDICTION_SETUP: &str = r#"
try {
    $lauralPredictionOption = Get-Command Set-PSReadLineOption -ErrorAction Stop
    if ($lauralPredictionOption.Parameters.ContainsKey('PredictionSource') -and $lauralPredictionOption.Parameters.ContainsKey('PredictionViewStyle')) {
        Set-PSReadLineOption -PredictionSource History -PredictionViewStyle InlineView -ErrorAction Stop
    }
} catch { }
"#;

pub(crate) fn startup_command(shell: &str, enabled: bool, existing: &str) -> String {
    if shell == "powershell" && enabled {
        format!("{PREDICTION_SETUP}\n{existing}")
    } else {
        existing.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solo_antepone_prediccion_local_a_powershell_si_se_activa() {
        let existing = "function global:prompt { 'PS> ' }";
        let startup = startup_command("powershell", true, existing);

        assert!(startup.starts_with("\ntry {"));
        assert!(startup.contains("Get-Command Set-PSReadLineOption -ErrorAction Stop"));
        assert!(startup.contains("-PredictionSource History -PredictionViewStyle InlineView"));
        assert!(startup.ends_with(existing));
    }

    #[test]
    fn mantiene_el_inicio_original_si_se_desactiva_o_no_es_powershell() {
        let existing = "inicio original";

        assert_eq!(startup_command("powershell", false, existing), existing);
        assert_eq!(startup_command("cmd", true, existing), existing);
        assert_eq!(startup_command("wsl", true, existing), existing);
        assert_eq!(startup_command("git-bash", true, existing), existing);
    }
}
