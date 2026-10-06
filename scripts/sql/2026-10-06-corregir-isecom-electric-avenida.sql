-- Corrección con los datos de Mis Comprobantes de ARCA (Ewwo, 6-oct-2026).
-- Idempotente: cada UPDATE sólo actúa si el dato sigue mal.
--
-- 1) ISECOM S.A. FA 0015-00024693 (cmuwrp570001ylpy3crhqnwhd): el QR del emisor
--    decía DOL con TC 1545, pero en ARCA es en PESOS (moneda $, TC 1). Además el
--    IVA estaba todo en 21 %: ARCA lo abre en 21 % y 10,5 %.
-- 2) ELECTRIC AVENIDA S.A. FA 0003-00014211 (cmuwrp5g9002dlpy3k9gd1hhl): el OCR
--    tomó como emisor el recuadro del cliente (EWWO CONSULTING S.R.L.). El CUIT
--    ya era el correcto (del QR); falta la razón social y la contraparte.
BEGIN;

-- 1) ISECOM
INSERT INTO "AuditLog" (id, "empresaId", "usuarioId", entidad, "entidadId", accion, antes, despues)
SELECT 'aud_isecom_arca_20261006', m."empresaId", 'cmqqigtr30000wq7vssd8a4n3', 'Movimiento', m.id, 'CORREGIR_DESDE_ARCA',
       jsonb_build_object('moneda', m.moneda, 'tipoCambio', m."tipoCambio", 'netoGravado', m."netoGravado", 'iva21', m.iva21, 'iva105', m.iva105),
       jsonb_build_object('moneda', 'ARS', 'tipoCambio', null, 'netoGravado', 2006707.80, 'iva21', 192100.36, 'iva105', 114654.14,
         'cambios', jsonb_build_array('Moneda: USD (TC 1.545) → ARS', 'IVA 21 %: 306.754,50 → 192.100,36', 'IVA 10,5 %: — → 114.654,14'))
FROM "Movimiento" m
WHERE m.id = 'cmuwrp570001ylpy3crhqnwhd' AND m.moneda = 'USD'
ON CONFLICT (id) DO NOTHING;

UPDATE "Movimiento"
SET moneda = 'ARS', "tipoCambio" = NULL, "netoGravado" = 2006707.80, iva21 = 192100.36, iva105 = 114654.14, "updatedAt" = now()
WHERE id = 'cmuwrp570001ylpy3crhqnwhd' AND moneda = 'USD';

-- 2) ELECTRIC AVENIDA
INSERT INTO "Contraparte" (id, "empresaId", cuit, "razonSocial", tipo)
VALUES ('ctr_electric_avenida_ewwo', 'cmqqigtrh0004wq7vxhcdipl4', '30516314466', 'ELECTRIC AVENIDA S. A.', 'PROVEEDOR')
ON CONFLICT ("empresaId", cuit) DO NOTHING;

INSERT INTO "AuditLog" (id, "empresaId", "usuarioId", entidad, "entidadId", accion, despues)
SELECT 'aud_electric_ctr_20261006', c."empresaId", 'cmqqigtr30000wq7vssd8a4n3', 'Contraparte', c.id, 'CREAR',
       jsonb_build_object('cuit', c.cuit, 'razonSocial', c."razonSocial", 'tipo', c.tipo, 'desdeArca', true)
FROM "Contraparte" c
WHERE c.id = 'ctr_electric_avenida_ewwo'
ON CONFLICT (id) DO NOTHING;

INSERT INTO "AuditLog" (id, "empresaId", "usuarioId", entidad, "entidadId", accion, antes, despues)
SELECT 'aud_electric_arca_20261006', m."empresaId", 'cmqqigtr30000wq7vssd8a4n3', 'Movimiento', m.id, 'CORREGIR_DESDE_ARCA',
       jsonb_build_object('razonSocialEmisor', m."extraccionRaw"->>'razonSocialEmisor', 'contraparteId', m."contraparteId"),
       jsonb_build_object('razonSocialEmisor', 'ELECTRIC AVENIDA S. A.',
         'cambios', jsonb_build_array('Emisor: EWWO CONSULTING S.R.L. (recuadro del cliente) → ELECTRIC AVENIDA S. A. (CUIT 30-51631446-6)', 'Contraparte vinculada: ELECTRIC AVENIDA S. A.'))
FROM "Movimiento" m
WHERE m.id = 'cmuwrp5g9002dlpy3k9gd1hhl' AND m."contraparteId" IS NULL
ON CONFLICT (id) DO NOTHING;

UPDATE "Movimiento" m
SET "contraparteId" = c.id,
    "extraccionRaw" = jsonb_set(m."extraccionRaw"::jsonb, '{razonSocialEmisor}', to_jsonb(c."razonSocial")),
    "camposRevisar" = (m."camposRevisar"::jsonb - 'contraparte'),
    "updatedAt" = now()
FROM "Contraparte" c
WHERE m.id = 'cmuwrp5g9002dlpy3k9gd1hhl' AND m."contraparteId" IS NULL
  AND c."empresaId" = m."empresaId" AND c.cuit = '30516314466';

-- Control: cómo quedaron.
SELECT id, moneda, "tipoCambio", iva21, iva105, "contraparteId", "extraccionRaw"->>'razonSocialEmisor' AS emisor, estado
FROM "Movimiento" WHERE id IN ('cmuwrp570001ylpy3crhqnwhd', 'cmuwrp5g9002dlpy3k9gd1hhl');

COMMIT;
