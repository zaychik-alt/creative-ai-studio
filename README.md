# CREATIVE AI STUDIO

## Despliegue desde Android
1. Descomprime el ZIP en el teléfono.
2. Sube todos los archivos a un repositorio PRIVADO de GitHub conservando la carpeta `public`.
3. Conecta el repositorio a un Web Service de Render.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. En Environment configura `OPENAI_API_KEY` y `STUDIO_PASSWORD`.
7. Despliega y abre la URL HTTPS asignada por Render.

La cuenta, la clave API, la contraseña y la facturación deben ser gestionadas por un adulto responsable. Nunca publiques la clave API ni la incluyas en el repositorio.

La aplicación requiere `STUDIO_PASSWORD` y protege tanto la web como sus rutas API mediante autenticación. Mantén el repositorio privado. La galería se guarda localmente en el navegador. Las generaciones tienen límites y costes del proveedor; no son ilimitadas ni gratuitas.

Documentación: https://render.com/docs/deploy-node-express-app y https://render.com/docs/configure-environment-variables
