-- Contadores para códigos de producto y códigos de barras internos (EAN-13).
-- Las secuencias de Postgres no se revierten con la transacción: pueden dejar huecos, y no importa,
-- porque estos códigos solo deben ser únicos (la numeración correlativa sin saltos es la de facturas).
CREATE SEQUENCE "product_code_seq" START 1;
CREATE SEQUENCE "barcode_serial_seq" START 1;
