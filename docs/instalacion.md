# Instalar Laural en Windows

1. En Windows 10 u 11 x64 abre las [publicaciones oficiales](https://github.com/elkangri23/laural/releases). Elige una versión y descarga su instalador EXE o MSI y el archivo de sumas de esa misma publicación.
2. En PowerShell ejecuta `Get-FileHash -Algorithm SHA256 -LiteralPath .\nombre-del-instalador.exe` sustituyendo el nombre. Compara el resultado con la línea del mismo archivo en las sumas. Si difieren, descarta la descarga.
3. Abre el instalador y sigue el asistente. Los paquetes alpha actuales carecen de firma digital. La interfaz necesita Microsoft Edge WebView2 Runtime.
4. Abre Laural y crea una pestaña de PowerShell. Para usar WSL necesitas una distribución instalada. Git Bash requiere Git for Windows.
5. Arranca tu servidor de modelos y sigue la [guía de configuración](configuracion.md).

Para actualizar, cierra las terminales después de guardar el trabajo y consulta las notas de la nueva publicación. La actualización entre alphas está pendiente de validación. Para desinstalar, abre Aplicaciones instaladas de Windows, selecciona Laural y elige Desinstalar. Si necesitas eliminar conversaciones, usa Borrar historial antes de desinstalar. La eliminación de datos y credenciales por el desinstalador está pendiente de verificación.

Para compilar desde el código consulta el [entorno de desarrollo](development/setup.md).
