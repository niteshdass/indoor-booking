/**
 * Platform admin documentation: one topic per setting, grouped for the docs sidebar.
 * Text supports `code` and [links](https://…) inline; everything else is plain.
 */
export type Block =
  | { p: string }
  | { steps: string[] }
  | { list: string[] }
  | { code: string }
  | { table: { head: string[]; rows: string[][] } }
  | { note: string; tone: 'info' | 'warning' };

export type DocSection = { id: string; title: string; blocks: Block[] };

export type GroupId = 'start' | 'signin' | 'messages' | 'server';
export type TopicId = 'overview' | 'google' | 'email' | 'sms' | 'encryption' | 'server-config';

export type DocTopic = {
  id: TopicId;
  group: GroupId;
  title: string;
  summary: string;
  /** The Admin > Settings tab this topic configures. */
  settings?: 'google' | 'email' | 'sms';
  sections: DocSection[];
};

export type Docs = { groups: Record<GroupId, string>; topics: DocTopic[] };

export const GROUP_ORDER: GroupId[] = ['start', 'signin', 'messages', 'server'];

export const docsEn: Docs = {
  groups: { start: 'Getting started', signin: 'Sign-in', messages: 'Messages', server: 'Server and security' },
  topics: [
    {
      id: 'overview',
      group: 'start',
      title: 'How settings work',
      summary: 'Admin > Settings holds the services the whole platform depends on: Google sign-in, email and SMS. Business owners never see these settings.',
      sections: [
        {
          id: 'source',
          title: 'Where a value comes from',
          blocks: [
            { p: 'Every setting has two possible sources. A value saved in Admin > Settings always wins; without one, the server falls back to its environment variables. The badge on each settings card tells you which is in use.' },
            {
              table: {
                head: ['Badge', 'Meaning'],
                rows: [
                  ['Set here', 'Saved in Admin > Settings. This value is used.'],
                  ['Server config', 'Nothing saved here, so the server environment variable is used.'],
                  ['Not set', 'Neither is set. The feature is off (see below).'],
                ],
              },
            },
          ],
        },
        {
          id: 'apply',
          title: 'When changes apply',
          blocks: [
            { p: 'Saved values reach every API server within 15 seconds. No restart or redeploy is needed. Pages that are already open (such as the sign-in page) pick up a new Google client ID on reload.' },
            { p: '"Use server config" deletes the saved value; the environment variable, if there is one, takes over again.' },
          ],
        },
        {
          id: 'access',
          title: 'Who can change settings',
          blocks: [
            { p: 'Platform roles with the `platform.settings` permission, which Super Admin has by default. Every save records who made it and when; the latest change shows at the top of the Settings page.' },
          ],
        },
        {
          id: 'unset',
          title: 'When nothing is configured',
          blocks: [
            {
              list: [
                'Google sign-in: the Google button is hidden. Phone and email sign-in keep working.',
                'Email and SMS in development: messages are printed to the API server console instead of being sent, so you can still read codes while testing.',
                'Email and SMS in production: nothing is sent. People see "Message delivery is not set up yet" where a code or email was expected.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'google',
      group: 'signin',
      title: 'Google sign-in',
      summary: 'Adds "Sign in with Google" to the sign-in page and "Sign up with Google" to create account. People pick an account in Google\'s own window; no password is needed.',
      settings: 'google',
      sections: [
        {
          id: 'how',
          title: 'How it works',
          blocks: [
            { p: 'The sign-in page loads Google\'s button with your client ID. Google shows its account chooser and hands back a signed token, which the server checks against the same client ID before signing the person in.' },
            { p: 'A first-time Google user gets a new account. If an account with the same email already exists, the person is asked to sign in to it the usual way and link Google from their profile: accounts are never merged automatically.' },
          ],
        },
        {
          id: 'create',
          title: 'Create a client ID',
          blocks: [
            {
              steps: [
                'Open [Google Cloud Console](https://console.cloud.google.com/) and pick a project, or create one for this site.',
                'Check the project name at the top of the page. The client ID belongs to that project, so switch first if it is the wrong one.',
                'Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) (APIs & Services > OAuth consent screen leads there too) and press Get started.',
                'App information: the app name people will see in Google\'s window, and your support email. Audience: External. Contact information: your email. Then agree to the policy and press Create.',
                'Go to Audience > Test users and add the Google accounts that will sign in while the app is in Testing, starting with your own.',
                'Go to Clients and press Create client. Application type: Web application. Give it any name.',
                'Under Authorised JavaScript origins, add every address the site is opened on, for example `https://yourdomain.com` and, for local development, `http://localhost:5173`. Scheme and host only: no path and no trailing slash.',
                'Leave Authorised redirect URIs empty: the popup sign-in does not use them.',
                'Create, then copy the client ID. It ends with `.apps.googleusercontent.com`. The client secret is not needed.',
              ],
            },
          ],
        },
        {
          id: 'save',
          title: 'Save it here',
          blocks: [
            { steps: ['Open Admin > Settings > Google sign-in.', 'Paste the client ID and press Save.', 'Reload the sign-in page: the Google button appears above the phone and email options.'] },
          ],
        },
        {
          id: 'publish',
          title: 'Testing vs. published',
          blocks: [
            { note: 'A new app starts in "Testing": only the test users listed under Audience can sign in, up to 100. Publish it before opening sign-in to everyone.', tone: 'warning' },
            {
              steps: [
                'Open Google Auth Platform > Branding. Fill in the app home page, the privacy policy link and, under Authorised domains, your domain (for example `yourdomain.com`). `localhost` cannot be used here, so this step waits until the site has a real domain.',
                'Open Audience and press Publish app. It stays greyed out until Branding is complete.',
                'Make sure the live address, for example `https://yourdomain.com`, is in the client\'s Authorised JavaScript origins under Clients.',
              ],
            },
            { p: 'Sign-in asks only for name, email and profile picture, so Google does not need to review the app before you publish.' },
          ],
        },
        {
          id: 'troubleshooting',
          title: 'Troubleshooting',
          blocks: [
            {
              table: {
                head: ['What you see', 'What to do'],
                rows: [
                  ['No Google button', 'No client ID is set, or the page was open before you saved. Check the badge in Settings and reload the page.'],
                  ['"Error 400: origin_mismatch" or "origin is not allowed"', 'The address in the browser bar is not in Authorised JavaScript origins. Add it exactly (http vs https, port). Google can take a few minutes to apply the change.'],
                  ['"Access blocked" or "app has not completed verification"', 'The app is still in Testing. Add the person under Audience > Test users, or publish the app.'],
                  ['"Publish app" is greyed out', 'Branding is not complete. Add the home page, privacy policy link and authorised domain, then try again.'],
                  ['"Sign-in with Google failed" from this site', 'The page used an older client ID than the server has now. Reload the page and try again.'],
                ],
              },
            },
          ],
        },
        { id: 'env', title: 'Server fallback', blocks: [{ p: 'Environment variable: `GOOGLE_CLIENT_ID`. Used only when nothing is saved here.' }] },
      ],
    },
    {
      id: 'email',
      group: 'messages',
      title: 'Email (SMTP)',
      summary: 'Sends verification codes, password reset links and booking emails through any SMTP server.',
      settings: 'email',
      sections: [
        {
          id: 'fields',
          title: 'Fields',
          blocks: [
            {
              table: {
                head: ['Field', 'What to enter'],
                rows: [
                  ['SMTP host', 'Your provider\'s SMTP server, e.g. `smtp.gmail.com`.'],
                  ['Port', '`587` for most providers (STARTTLS). `465` if the provider says SSL/TLS. Avoid `25`: many hosts block it.'],
                  ['Use TLS from the start', 'On only for port 465. Off for 587, which upgrades to TLS by itself.'],
                  ['Username', 'The SMTP login. Leave blank only if the server accepts mail without signing in.'],
                  ['Password', 'The SMTP password or API key. Stored encrypted and never shown again; leave blank to keep the saved one.'],
                  ['From', 'Name and address people see, e.g. `Slots <no-reply@yourdomain.com>`. The provider must allow sending from this address.'],
                ],
              },
            },
          ],
        },
        {
          id: 'providers',
          title: 'Common providers',
          blocks: [
            {
              table: {
                head: ['Provider', 'Host', 'Port', 'Username and password'],
                rows: [
                  ['Gmail / Google Workspace', '`smtp.gmail.com`', '587', 'Full address and an [app password](https://myaccount.google.com/apppasswords) (needs 2-Step Verification). Personal Gmail sends about 500 emails a day.'],
                  ['Microsoft 365 / Outlook', '`smtp.office365.com`', '587', 'Full address and its password. SMTP AUTH must be enabled for the mailbox.'],
                  ['SendGrid', '`smtp.sendgrid.net`', '587', 'Username is literally `apikey`; the password is an API key.'],
                  ['Mailgun', '`smtp.mailgun.org`', '587', 'SMTP login and password from the domain\'s settings.'],
                  ['Amazon SES', '`email-smtp.<region>.amazonaws.com`', '587', 'SMTP credentials created in SES (not IAM access keys). Verify the From address or domain first.'],
                  ['Brevo', '`smtp-relay.brevo.com`', '587', 'Login and SMTP key from the SMTP & API page.'],
                ],
              },
            },
          ],
        },
        {
          id: 'test',
          title: 'Send a test',
          blocks: [{ p: 'After saving, use "Send a test" on the Email tab. It sends with the settings in use right now and shows the provider\'s reply if it refuses.' }],
        },
        {
          id: 'secrets',
          title: 'Changing the password',
          blocks: [{ p: 'Leave Password blank to keep the saved one. If you change the username, enter the password again: a saved password is only kept for the same login.' }],
        },
        {
          id: 'troubleshooting',
          title: 'Troubleshooting',
          blocks: [
            {
              table: {
                head: ['What you see', 'What to do'],
                rows: [
                  ['`535 Authentication failed`', 'Wrong username or password. Gmail needs an app password, not the account password.'],
                  ['Timeout or `ECONNREFUSED`', 'Wrong host or port, or the server blocks outgoing SMTP. Try 465 with TLS from the start.'],
                  ['`wrong version number` or another SSL error', 'The TLS checkbox does not match the port: on for 465, off for 587.'],
                  ['Mail lands in spam', 'Set up SPF and DKIM for your domain at the provider, and send From that domain.'],
                ],
              },
            },
          ],
        },
        {
          id: 'env',
          title: 'Server fallback',
          blocks: [{ p: 'Environment variables `SMTP_URL` and `EMAIL_FROM`, set together:' }, { code: 'SMTP_URL=smtp://user:password@smtp.example.com:587\nEMAIL_FROM="Slots <no-reply@example.com>"' }],
        },
      ],
    },
    {
      id: 'sms',
      group: 'messages',
      title: 'SMS (Twilio)',
      summary: 'Sends phone verification codes and booking texts through a Twilio account.',
      settings: 'sms',
      sections: [
        {
          id: 'setup',
          title: 'Get your Twilio details',
          blocks: [
            {
              steps: [
                'Sign up at [twilio.com](https://www.twilio.com/) and open the Console.',
                'On the Console home, under Account Info, copy the Account SID (starts with `AC`) and the Auth token.',
                'Phone Numbers > Buy a number: pick one with SMS capability.',
                'Messaging > Settings > Geo permissions: turn on every country you send to.',
                'In Admin > Settings > SMS, paste the three values, Save, then send a test to your own phone.',
              ],
            },
          ],
        },
        {
          id: 'fields',
          title: 'Fields',
          blocks: [
            {
              table: {
                head: ['Field', 'What to enter'],
                rows: [
                  ['Account SID', '`AC` followed by 32 letters and digits.'],
                  ['Auth token', 'Stored encrypted and never shown again. Leave blank to keep the saved one (same Account SID only).'],
                  ['From number', 'Your Twilio number in international format, e.g. `+15550001111`.'],
                ],
              },
            },
          ],
        },
        {
          id: 'trial',
          title: 'Trial accounts',
          blocks: [{ note: 'A trial account only sends to numbers you have verified in Twilio, and adds "Sent from your Twilio trial account" to every text. Upgrade before real players sign up.', tone: 'warning' }],
        },
        {
          id: 'rotate',
          title: 'Rotating the auth token',
          blocks: [{ p: 'After you rotate the token in Twilio, paste the new one here and save. Texts fail with error 20003 until you do.' }],
        },
        {
          id: 'troubleshooting',
          title: 'Troubleshooting',
          blocks: [
            {
              table: {
                head: ['Twilio error', 'What to do'],
                rows: [
                  ['20003 Authenticate', 'Account SID or auth token is wrong, or the token was rotated.'],
                  ['21608', 'Trial account and the number is not verified. Verify it or upgrade.'],
                  ['21408', 'Geo permission for that country is off.'],
                  ['21606 or 21659', 'The From number is not yours in Twilio or cannot send SMS.'],
                  ['Sent but never arrives', 'Check Twilio Console > Monitor > Logs > Messaging for the carrier\'s reason.'],
                ],
              },
            },
          ],
        },
        {
          id: 'env',
          title: 'Server fallback',
          blocks: [{ p: 'Environment variables, all three together:' }, { code: 'TWILIO_ACCOUNT_SID=AC…\nTWILIO_AUTH_TOKEN=…\nTWILIO_FROM=+15550001111' }],
        },
      ],
    },
    {
      id: 'encryption',
      group: 'server',
      title: 'Encryption key',
      summary: 'The server key that encrypts saved passwords and tokens: the SMTP password, the Twilio auth token and business owners\' Stripe keys.',
      sections: [
        {
          id: 'what',
          title: 'What it protects',
          blocks: [
            { p: 'Secrets are encrypted with AES-256-GCM using `PAYMENTS_ENCRYPTION_KEY` before they reach the database, and are never sent back to the browser. The dashboard only shows whether one is saved.' },
            { p: 'Without the key, Settings shows a warning and the password and token fields are disabled. Production refuses to start without it.' },
          ],
        },
        {
          id: 'generate',
          title: 'Create the key',
          blocks: [{ p: 'Generate 32 random bytes in base64, set them in the API server environment and restart it:' }, { code: 'openssl rand -base64 32' }, { code: 'PAYMENTS_ENCRYPTION_KEY=<the output>' }],
        },
        {
          id: 'keep',
          title: 'Keep it safe',
          blocks: [{ note: 'Changing or losing the key makes every saved secret unreadable. You would need to re-enter the SMTP password and Twilio token, and every business would need to reconnect Stripe. Keep a copy in your password manager.', tone: 'warning' }],
        },
      ],
    },
    {
      id: 'server-config',
      group: 'server',
      title: 'Server config (.env)',
      summary: 'Environment variables the API server reads at start-up. They are the fallback for anything not saved in Admin > Settings.',
      sections: [
        {
          id: 'vars',
          title: 'Variables',
          blocks: [
            {
              table: {
                head: ['Variable', 'Used for'],
                rows: [
                  ['`GOOGLE_CLIENT_ID`', 'Google sign-in client ID.'],
                  ['`SMTP_URL`, `EMAIL_FROM`', 'Email: SMTP server as a URL and the From address. Set both or neither.'],
                  ['`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`', 'SMS through Twilio. Set all three or none.'],
                  ['`PAYMENTS_ENCRYPTION_KEY`', 'Encrypts saved secrets. Required in production. Can only be set here.'],
                ],
              },
            },
          ],
        },
        {
          id: 'rules',
          title: 'Rules',
          blocks: [
            {
              list: [
                'A value saved in Admin > Settings always wins over the environment.',
                'A half-set group (for example `SMTP_URL` without `EMAIL_FROM`) stops the server from starting, with a message naming the missing variable.',
                'Changes to the environment need a server restart; changes in Admin > Settings do not.',
              ],
            },
          ],
        },
        {
          id: 'example',
          title: 'Example',
          blocks: [
            {
              code: 'GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com\nSMTP_URL=smtp://apikey:SG.xxxx@smtp.sendgrid.net:587\nEMAIL_FROM="Slots <no-reply@yourdomain.com>"\nTWILIO_ACCOUNT_SID=AC…\nTWILIO_AUTH_TOKEN=…\nTWILIO_FROM=+15550001111\nPAYMENTS_ENCRYPTION_KEY=<openssl rand -base64 32>',
            },
          ],
        },
      ],
    },
  ],
};
