type BackupRetentionControlProps = {
  value: number | null;
  onChange: (value: number | null) => void;
};

export function BackupRetentionControl({ value, onChange }: BackupRetentionControlProps) {
  return <>
    <label>Retención de copias
      <select aria-label="Retención automática de copias por archivo" value={value ?? "none"} onChange={(event) => onChange(event.currentTarget.value === "none" ? null : Number(event.currentTarget.value))}>
        <option value="none">Sin límite</option>
        <option value="5">5 copias</option>
        <option value="10">10 copias</option>
        <option value="20">20 copias</option>
        <option value="50">50 copias</option>
        <option value="100">100 copias</option>
      </select>
    </label>
    <p>Al guardar o restaurar un archivo, las copias más antiguas se eliminan al superar el límite.</p>
  </>;
}
