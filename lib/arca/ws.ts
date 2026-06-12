import { promises as fs } from 'node:fs';
import { CODIGO_ARCA, type ArcaConstatacion, type ArcaInput, type ArcaResultado } from './index';

// Real-mode skeleton (ARCA_MODE=ws) for the ARCA "Constatación de Comprobantes"
// web service (wscdc). The full protocol is:
//
//   1. WSAA authentication: build a TRA (access ticket request) XML for the
//      "wscdc" service, sign it as a CMS/PKCS#7 envelope with the X.509
//      certificate + private key issued by ARCA, POST it to the WSAA SOAP
//      endpoint, and cache the returned token+sign until expiration (~12 h).
//   2. wscdc ComprobanteConstatar: call the SOAP method with token/sign and
//      the voucher data, then translate the response to {estado, detalle}.
//
// What you need to enable this mode (documented in README):
//   - A digital certificate issued by ARCA associated to ARCA_CUIT.
//   - The "Constatación de Comprobantes" WS authorized for that certificate.
//   - ARCA_CERT_PATH / ARCA_KEY_PATH pointing to the PEM files, ARCA_ENV=homo|prod.
//
// The CMS signing step requires a PKCS#7 implementation (e.g. an openssl
// child process or a dedicated lib). To keep the MVP dependency-free it is
// left as a marked extension point; without it this class degrades to
// ERROR_CONSULTA and the app keeps working (mock remains the default).

const WSAA_URL = {
  homo: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};
const WSCDC_URL = {
  homo: 'https://wswhomo.afip.gov.ar/WSCDC/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/WSCDC/service.asmx',
};

type Ticket = { token: string; sign: string; expira: Date };

export class ArcaConstatacionWs implements ArcaConstatacion {
  private ticket: Ticket | null = null;

  async constatar(input: ArcaInput): Promise<ArcaResultado> {
    const consultadoAt = new Date();
    try {
      const ticket = await this.obtenerTicket();
      return await this.comprobanteConstatar(ticket, input, consultadoAt);
    } catch (err) {
      return {
        estado: 'ERROR_CONSULTA',
        detalle: `No se pudo consultar ARCA: ${err instanceof Error ? err.message : String(err)}`,
        consultadoAt,
      };
    }
  }

  private async obtenerTicket(): Promise<Ticket> {
    if (this.ticket && this.ticket.expira.getTime() > Date.now() + 60_000) return this.ticket;

    const certPath = process.env.ARCA_CERT_PATH;
    const keyPath = process.env.ARCA_KEY_PATH;
    if (!certPath || !keyPath) {
      throw new Error('ARCA_MODE=ws requiere ARCA_CERT_PATH y ARCA_KEY_PATH');
    }
    await fs.access(certPath);
    await fs.access(keyPath);

    const ahora = new Date();
    const tra = `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>
    <generationTime>${new Date(ahora.getTime() - 10 * 60_000).toISOString()}</generationTime>
    <expirationTime>${new Date(ahora.getTime() + 12 * 3600_000).toISOString()}</expirationTime>
  </header>
  <service>wscdc</service>
</loginTicketRequest>`;

    // TODO: requiere certificado ARCA — sign `tra` as CMS (PKCS#7, DER, base64)
    // using ARCA_CERT_PATH + ARCA_KEY_PATH (openssl smime -sign -outform DER
    // -nodetach), then POST the SOAP loginCms envelope to WSAA_URL[env] and
    // parse <token>, <sign> and <expirationTime> from the loginTicketResponse.
    void tra;
    void WSAA_URL;
    throw new Error(
      'Firma CMS del TRA no implementada: requiere certificado ARCA y un firmador PKCS#7 (ver README, sección ARCA).',
    );
  }

  private async comprobanteConstatar(ticket: Ticket, input: ArcaInput, consultadoAt: Date): Promise<ArcaResultado> {
    const env = (process.env.ARCA_ENV ?? 'homo') as 'homo' | 'prod';
    const codigo = CODIGO_ARCA[input.tipoComprobante];
    if (!codigo) throw new Error(`Tipo de comprobante sin código ARCA: ${input.tipoComprobante}`);

    const body = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://servicios1.afip.gob.ar/wscdc/">
  <soap:Body>
    <ar:ComprobanteConstatar>
      <ar:Auth>
        <ar:Token>${ticket.token}</ar:Token>
        <ar:Sign>${ticket.sign}</ar:Sign>
        <ar:Cuit>${process.env.ARCA_CUIT ?? ''}</ar:Cuit>
      </ar:Auth>
      <ar:CmpReq>
        <ar:CbteModo>CAE</ar:CbteModo>
        <ar:CuitEmisor>${input.cuitEmisor}</ar:CuitEmisor>
        <ar:PtoVta>${input.puntoVenta}</ar:PtoVta>
        <ar:CbteTipo>${codigo}</ar:CbteTipo>
        <ar:CbteNro>${input.numero}</ar:CbteNro>
        <ar:CbteFch>${input.fecha.replace(/-/g, '')}</ar:CbteFch>
        <ar:ImpTotal>${input.importeTotal.toFixed(2)}</ar:ImpTotal>
        <ar:CodAutorizacion>${input.cae}</ar:CodAutorizacion>
        ${input.cuitReceptor ? `<ar:DocTipoReceptor>80</ar:DocTipoReceptor><ar:DocNroReceptor>${input.cuitReceptor}</ar:DocNroReceptor>` : ''}
      </ar:CmpReq>
    </ar:ComprobanteConstatar>
  </soap:Body>
</soap:Envelope>`;

    const res = await fetch(WSCDC_URL[env], {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: 'http://servicios1.afip.gob.ar/wscdc/ComprobanteConstatar',
      },
      body,
    });
    const xml = await res.text();
    const resultado = xml.match(/<Resultado>(.*?)<\/Resultado>/)?.[1];
    const observaciones = xml.match(/<Obs>[\s\S]*?<Msg>(.*?)<\/Msg>/)?.[1];
    if (resultado === 'A') return { estado: 'VALIDO', detalle: 'Comprobante autorizado por ARCA', consultadoAt };
    if (resultado === 'R') return { estado: 'INVALIDO', detalle: observaciones ?? 'Rechazado por ARCA', consultadoAt };
    throw new Error(`Respuesta inesperada del WS: ${xml.slice(0, 300)}`);
  }
}
