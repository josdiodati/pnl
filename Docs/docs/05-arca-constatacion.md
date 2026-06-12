# 05 — Constatación de comprobantes contra ARCA

ARCA (ex AFIP) ofrece un Web Service de **Constatación de Comprobantes** (históricamente *wscdc*) que, dado un comprobante ya emitido, responde si fue efectivamente autorizado por el fisco. Acá lo usamos **solo para constatar** comprobantes que ya cargamos (no para descargar comprobantes automáticamente — eso es alcance futuro).

## Interfaz

```ts
interface ArcaConstatacion {
  constatar(input: {
    cuitEmisor: string;
    tipoComprobante: string;   // mapear a código ARCA (1=Factura A, 6=Factura B, 11=Factura C, etc.)
    puntoVenta: number;
    numero: number;
    fecha: string;             // YYYY-MM-DD
    importeTotal: number;
    cae: string;
    cuitReceptor?: string;
  }): Promise<{
    estado: "VALIDO" | "INVALIDO" | "ERROR_CONSULTA";
    detalle?: string;
    consultadoAt: Date;
  }>;
}
```

## Implementaciones

### `ArcaConstatacionMock` (default, `ARCA_MODE=mock`)
- Determinística para poder testear ambos caminos: devuelve `VALIDO` salvo cuando el `cae` termina en `"00"` → `INVALIDO`, y cuando el CAE está vacío → `ERROR_CONSULTA`.
- Sin red, sin credenciales. Es el modo en que corre la app por defecto.

### `ArcaConstatacionWs` (`ARCA_MODE=ws`)
- Implementar el esqueleto real:
  1. **WSAA**: autenticación de ARCA con certificado X.509. Generar el TRA (ticket de requerimiento de acceso) para el servicio `wscdc`, firmarlo (CMS) con la `ARCA_KEY` + `ARCA_CERT`, llamar al WSAA (`ARCA_ENV` homologación o producción) y obtener el `token`+`sign`, cacheándolos hasta su expiración (~12 h).
  2. **wscdc**: con el ticket, invocar el método de constatación de comprobante (`ComprobanteConstatar`) mapeando los campos del input a los del WS, y traducir la respuesta a `{estado, detalle}`.
- Donde el protocolo no pueda completarse sin credenciales reales, dejar el punto de extensión claramente marcado (`// TODO: requiere certificado ARCA`) y **no romper el build**. La app debe seguir corriendo en mock.
- Config por env: `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_CUIT` (CUIT representado), `ARCA_ENV`.

## Comportamiento en la app

- La constatación se dispara automáticamente tras la extracción **si hay CAE**, como Job `ARCA`. También se puede re-disparar a mano desde la vista de validación.
- Resultado en el movimiento: `arcaEstado` + `arcaConsultadoAt`. Badge en la cola y en la vista de validación: verde `VALIDO`, rojo `INVALIDO`, gris `NO_VERIFICADO/ERROR_CONSULTA`.
- Un movimiento `INVALIDO` **no se bloquea**, pero validarlo exige una **confirmación extra explícita** del validador ("este comprobante figura como inválido en ARCA, confirmo igual"), que queda registrada en auditoría.
- Documentar en README qué hay que tramitar en ARCA para activar el modo `ws`: certificado digital, alta del WS de constatación, CUIT y punto de acceso de homologación vs producción.
