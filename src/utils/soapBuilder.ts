/**
 * SOAP XML Builder for SFMC Data Extension operations
 */

/**
 * Property interface for Data Extension fields
 */
export interface DEProperty {
  Name: string;
  Value: string;
}

/**
 * Escape XML special characters to prevent injection
 */
export function escapeXml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) {
    return '';
  }
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalize SOAP endpoint URL - removes trailing slashes and ensures no double slashes
 */
function normalizeSoapUrl(url: string): string {
  if (!url) return '';
  // Remove trailing slashes
  let normalized = url.replace(/\/+$/, '');
  // Remove double slashes (except after protocol)
  normalized = normalized.replace(/([^:])\/\/+/g, '$1/');
  return normalized;
}

/**
 * Build SOAP XML for CreateRequest (Insert) operation
 */
export function buildCreateSoapEnvelope(
  accessToken: string,
  soapEndpoint: string,
  customerKey: string,
  properties: DEProperty[]
): string {
  const propertiesXml = properties
    .map(
      (prop) => `
          <Property>
            <Name>${escapeXml(prop.Name)}</Name>
            <Value>${escapeXml(prop.Value)}</Value>
          </Property>`
    )
    .join('');

  // Normalize the endpoint URL to prevent double slashes
  const normalizedEndpoint = normalizeSoapUrl(soapEndpoint);
  const toHeaderUrl = `${normalizedEndpoint}/Service.asmx`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing"
  xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
  <s:Header>
    <a:Action s:mustUnderstand="1">Create</a:Action>
    <a:To s:mustUnderstand="1">${toHeaderUrl}</a:To>
    <fueloauth xmlns="http://exacttarget.com">${accessToken}</fueloauth>
  </s:Header>
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <CreateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <Options />
      <Objects xsi:type="ns1:DataExtensionObject"
        xmlns:ns1="http://exacttarget.com/wsdl/partnerAPI">
        <CustomerKey>${escapeXml(customerKey)}</CustomerKey>
        <Properties>${propertiesXml}
        </Properties>
      </Objects>
    </CreateRequest>
  </s:Body>
</s:Envelope>`;
}

/**
 * Build SOAP XML for UpdateRequest operation
 */
export function buildUpdateSoapEnvelope(
  accessToken: string,
  soapEndpoint: string,
  customerKey: string,
  properties: DEProperty[]
): string {
  const propertiesXml = properties
    .map(
      (prop) => `
          <Property>
            <Name>${escapeXml(prop.Name)}</Name>
            <Value>${escapeXml(prop.Value)}</Value>
          </Property>`
    )
    .join('');

  // Normalize the endpoint URL to prevent double slashes
  const normalizedEndpoint = normalizeSoapUrl(soapEndpoint);
  const toHeaderUrl = `${normalizedEndpoint}/Service.asmx`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">Update</a:Action>
    <a:To s:mustUnderstand="1">${toHeaderUrl}</a:To>
    <fueloauth xmlns="http://exacttarget.com">${accessToken}</fueloauth>
  </s:Header>
  <s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <UpdateRequest xmlns="http://exacttarget.com/wsdl/partnerAPI">
      <Options />
      <Objects xsi:type="ns1:DataExtensionObject"
        xmlns:ns1="http://exacttarget.com/wsdl/partnerAPI">
        <CustomerKey>${escapeXml(customerKey)}</CustomerKey>
        <Properties>${propertiesXml}
        </Properties>
      </Objects>
    </UpdateRequest>
  </s:Body>
</s:Envelope>`;
}

/**
 * Convert a plain object to DEProperty array
 */
export function objectToProperties(data: Record<string, unknown>): DEProperty[] {
  return Object.entries(data).map(([key, value]) => ({
    Name: key,
    Value: String(value ?? ''),
  }));
}
