import { parseAddress } from '../config/app-config';
import { GraphMailer } from './mailer';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('GraphMailer', () => {
  const mail = { to: 'dlevi@x.test', subject: 'שלום', html: '<p>hi</p>', text: 'hi' };
  let fetchMock: jest.SpyInstance;
  const mailer = () => new GraphMailer({ tenantId: 'tid', clientId: 'cid', clientSecret: 'secret' }, { address: 'michal@golan.biz', name: 'Summer' });

  beforeEach(() => (fetchMock = jest.spyOn(global, 'fetch')));
  afterEach(() => fetchMock.mockRestore());

  it('gets an app token once, then sends as the MAIL_FROM mailbox with the logo inline', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'tok', expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const m = mailer();
    await m.send(mail);
    await m.send(mail);

    expect(fetchMock).toHaveBeenCalledTimes(3); // one token, two sends
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://login.microsoftonline.com/tid/oauth2/v2.0/token');
    expect(String(tokenInit.body)).toContain('grant_type=client_credentials');

    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/michal%40golan.biz/sendMail');
    expect(init.headers.authorization).toBe('Bearer tok');
    const { message, saveToSentItems } = JSON.parse(init.body);
    expect(saveToSentItems).toBe(false);
    expect(message).toMatchObject({
      subject: 'שלום',
      body: { contentType: 'HTML', content: '<p>hi</p>' },
      toRecipients: [{ emailAddress: { address: 'dlevi@x.test' } }],
      from: { emailAddress: { address: 'michal@golan.biz', name: 'Summer' } },
      attachments: [{ contentId: 'summer-logo', isInline: true, contentType: 'image/png' }],
    });
    expect(message.attachments[0].contentBytes.length).toBeGreaterThan(1000);
  });

  it("throws Graph's error (without the secret), and a 401 drops the cached token", async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, { access_token: 'old', expires_in: 3600 }))
      .mockResolvedValueOnce(json(401, { error: { code: 'InvalidAuthenticationToken', message: 'expired' } }))
      .mockResolvedValueOnce(json(200, { access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(json(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } }));
    const m = mailer();
    await expect(m.send(mail)).rejects.toThrow('Graph sendMail 401: InvalidAuthenticationToken: expired');
    const err = await m.send(mail).catch((e: Error) => e);
    expect((err as Error).message).toBe('Graph sendMail 403: ErrorAccessDenied: Access is denied.');
    expect((err as Error).message).not.toContain('secret');
    expect(fetchMock.mock.calls[3][1].headers.authorization).toBe('Bearer new');
  });

  it('reports a bad client secret from the token endpoint', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\nTrace ID: x' }));
    await expect(mailer().send(mail)).rejects.toThrow('Graph token 401: invalid_client: AADSTS7000215: Invalid client secret provided.');
  });
});

describe('parseAddress', () => {
  it('reads "Name <address>" and bare addresses', () => {
    expect(parseAddress('Summer <michal@golan.biz>')).toEqual({ name: 'Summer', address: 'michal@golan.biz' });
    expect(parseAddress('"Summer App" <a@b.c>')).toEqual({ name: 'Summer App', address: 'a@b.c' });
    expect(parseAddress('a@b.c')).toEqual({ name: '', address: 'a@b.c' });
    expect(parseAddress('Summer')).toBeNull();
  });
});
