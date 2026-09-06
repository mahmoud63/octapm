import { LegalDocument, LegalReviewNotice, type LegalSection } from './legal-document'

/**
 * OctaPM Privacy Policy.
 *
 * Written against what the platform genuinely does: site photographs carrying
 * GPS, daily logs naming individuals, timesheets, safety incidents, and
 * optional AI features that send content to a model provider. Those are the
 * parts a construction workforce actually cares about, and a policy copied
 * from another vendor would describe none of them correctly.
 */

const EFFECTIVE = '6 September 2026'

const SECTIONS: LegalSection[] = [
  {
    id: 'scope',
    heading: 'Who this covers',
    body: (
      <>
        <p>
          This policy explains how OctaPM handles personal data. It covers two
          different relationships:
        </p>
        <ul>
          <li>
            <strong>Our own users.</strong> The people who hold OctaPM accounts.
            For their account data we are the controller.
          </li>
          <li>
            <strong>Project data.</strong> The records an organisation puts into
            the platform, which may name workers, subcontractors and visitors.
            For that data the customer organisation is the controller and we are
            a processor acting on their instructions.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'account-data',
    heading: 'Account data we collect',
    body: (
      <ul>
        <li>Name, work email, telephone number and job role.</li>
        <li>The organisation and projects you belong to, and your role on each.</li>
        <li>
          Authentication data: a hashed password, two-factor enrolment, and — if
          your organisation uses single sign-on — the identifier your provider
          returns.
        </li>
        <li>
          Sign-in events, including time, IP address and device, kept for
          security.
        </li>
        <li>Your interface preferences, such as theme and notification settings.</li>
      </ul>
    ),
  },
  {
    id: 'project-data',
    heading: 'Personal data inside project records',
    body: (
      <>
        <p>
          Construction records name people. On a live project OctaPM may hold:
        </p>
        <ul>
          <li>
            <strong>Daily logs</strong> — manpower counts, named visitors,
            deliveries and delays.
          </li>
          <li>
            <strong>Timesheets</strong> — workers, hours, hourly rates and the
            activities worked.
          </li>
          <li>
            <strong>Site photographs</strong> — which may show people and may
            carry embedded GPS coordinates and a capture time.
          </li>
          <li>
            <strong>Safety records</strong> — incidents and observations, which
            can include health information.
          </li>
          <li>
            <strong>Correspondence and approvals</strong> — who raised, reviewed
            and approved each record, and when.
          </li>
        </ul>
        <p>
          The customer organisation decides what to put in. We process it to run
          the platform for them.
        </p>
      </>
    ),
  },
  {
    id: 'use',
    heading: 'How we use data',
    body: (
      <ul>
        <li>To provide the platform and the features you use.</li>
        <li>
          To authenticate you, enforce permissions, and keep the audit trail
          that gives project records their evidential value.
        </li>
        <li>To send notifications you or your administrator have enabled.</li>
        <li>To support you when you contact us, and to diagnose faults.</li>
        <li>To keep the service secure and detect abuse.</li>
        <li>To meet legal and regulatory obligations.</li>
      </ul>
    ),
  },
  {
    id: 'ai',
    heading: 'AI features and what leaves the platform',
    body: (
      <>
        <p>
          Where AI features are enabled, the relevant content — a document
          extract, a schedule summary, a daily log, a site photograph — is sent
          to the configured model provider to produce the draft, and the result
          is stored against the record so it can be audited.
        </p>
        <p>
          <strong>These features can be turned off.</strong> If your
          organisation has not configured an AI provider, no content is sent
          anywhere and the features degrade to their non-AI behaviour.
        </p>
      </>
    ),
  },
  {
    id: 'sharing',
    heading: 'Who we share data with',
    body: (
      <>
        <p>We do not sell personal data. We share it only:</p>
        <ul>
          <li>
            <strong>Within your project.</strong> With the parties your
            administrator has invited, limited to the access they were granted.
          </li>
          <li>
            <strong>With service providers</strong> who host, store, send email
            or process payments for us, under contract and only to provide the
            service.
          </li>
          <li>
            <strong>With systems you connect</strong> — an accounting
            integration, a webhook — at your organisation's instruction.
          </li>
          <li>
            <strong>Where the law requires it</strong>, or to establish or
            defend legal claims.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'retention',
    heading: 'How long we keep data',
    body: (
      <>
        <p>
          Project records are kept for as long as the organisation's account is
          active, and then in line with the retention period agreed with them.
        </p>
        <p>
          Approval and audit records are retained deliberately: a construction
          record without its history is not evidence. Deleting a record
          generally supersedes or voids it rather than erasing the trail.
        </p>
        <p>Security logs are kept for a limited period and then removed.</p>
      </>
    ),
  },
  {
    id: 'security',
    heading: 'How we protect data',
    body: (
      <ul>
        <li>Encryption in transit, and at rest for stored files.</li>
        <li>Passwords stored only as salted hashes; optional two-factor authentication.</li>
        <li>
          Every organisation's data is scoped by organisation identifier and
          enforced on the server, so one customer cannot reach another's records.
        </li>
        <li>Role-based permissions enforced by the API, not only hidden in the interface.</li>
        <li>An audit trail across approvals and record changes.</li>
      </ul>
    ),
  },
  {
    id: 'rights',
    heading: 'Your rights',
    body: (
      <>
        <p>
          Depending on where you live, you may have the right to access,
          correct, delete, restrict or object to processing of your personal
          data, and to receive it in a portable form.
        </p>
        <p>
          If the data sits inside a customer's project records,{' '}
          <strong>contact that organisation first</strong> — they control it. We
          will support them in responding.
        </p>
      </>
    ),
  },
  {
    id: 'transfers',
    heading: 'International transfers',
    body: (
      <p>
        Data may be processed in a country other than your own, including where
        our hosting or service providers operate. Where that happens we use
        appropriate safeguards for the transfer.
      </p>
    ),
  },
  {
    id: 'cookies',
    heading: 'Cookies and local storage',
    body: (
      <p>
        We use cookies and browser storage that are necessary to run the
        platform: keeping you signed in, remembering your interface preferences,
        and supporting offline capture in the field. We do not use them for
        advertising.
      </p>
    ),
  },
  {
    id: 'children',
    heading: "Children's data",
    body: (
      <p>
        OctaPM is a workplace tool and is not directed at children. We do not
        knowingly collect data from anyone under 16.
      </p>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: (
      <p>
        We may update this policy. For material changes we will give notice
        through the platform or by email before they take effect.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        Privacy questions, or a request about your data, can be sent to your
        OctaPM account contact or to the address published at octapm.com.
      </p>
    ),
  },
]

export function PrivacyPage() {
  return (
    <LegalDocument
      title='Privacy Policy'
      summary='What OctaPM does with personal data — your account, and the people named in the project records your organisation keeps here.'
      effectiveDate={EFFECTIVE}
      notice={<LegalReviewNotice />}
      sections={SECTIONS}
    />
  )
}
