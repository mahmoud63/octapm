import { LegalDocument, LegalReviewNotice, type LegalSection } from './legal-document'

/**
 * OctaPM Terms of Service.
 *
 * Written for OctaPM and for construction project controls specifically —
 * multi-party project access, ownership of project records, and the retention
 * of documents that carry contractual weight. It is deliberately not a copy of
 * any other vendor's terms: those name their entities, their jurisdictions and
 * their data practices, none of which would be true here.
 */

const EFFECTIVE = '6 September 2026'

const SECTIONS: LegalSection[] = [
  {
    id: 'agreement',
    heading: 'The agreement',
    body: (
      <>
        <p>
          These terms govern your organisation's use of OctaPM, a construction
          project management and project-controls platform. By creating an
          account, signing in, or using the platform on behalf of an
          organisation, you accept these terms and confirm you are authorised to
          accept them for that organisation.
        </p>
        <p>
          Where your organisation has signed a separate written agreement with
          us, that agreement takes precedence wherever the two conflict.
        </p>
      </>
    ),
  },
  {
    id: 'accounts',
    heading: 'Accounts, roles and access',
    body: (
      <>
        <p>
          An OctaPM organisation is administered by the person who creates it,
          who may invite others and assign roles. Roles determine what each
          person can see and do — the platform enforces this on the server, not
          only in the interface.
        </p>
        <ul>
          <li>
            You are responsible for keeping credentials confidential and for
            activity carried out under your accounts.
          </li>
          <li>
            You must tell us promptly if you believe an account has been
            compromised.
          </li>
          <li>
            Accounts are personal. Sharing one between people undermines the
            audit trail that gives project records their value.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'project-parties',
    heading: 'Project parties and external collaborators',
    body: (
      <>
        <p>
          Construction projects involve owners, consultants, main contractors,
          subcontractors and vendors. OctaPM lets you invite these parties to a
          project with scoped access.
        </p>
        <p>
          When you invite an external party you are directing us to disclose the
          project information within their scope to them. You are responsible
          for deciding who should have access, for the scope you grant, and for
          removing access when their involvement ends.
        </p>
      </>
    ),
  },
  {
    id: 'your-data',
    heading: 'Your project data',
    body: (
      <>
        <p>
          <strong>Your organisation owns its project data.</strong> Drawings,
          BOQs, schedules, cost records, RFIs, submittals, correspondence,
          photographs and every other record you create or upload remain yours.
        </p>
        <p>
          You grant us a limited licence to host, process, transmit, back up and
          display that data solely to provide and support the platform, and to
          the extent needed for security, troubleshooting and legal compliance.
        </p>
        <p>
          You confirm you have the rights to upload what you upload, including
          drawings and documents produced by third parties.
        </p>
      </>
    ),
  },
  {
    id: 'records',
    heading: 'Contractual records and audit trail',
    body: (
      <>
        <p>
          Much of what OctaPM holds has contractual significance: approvals,
          variations, extension-of-time claims, payment certificates and the
          audit trail behind them.
        </p>
        <p>
          The platform records who did what and when, and approval records are
          retained rather than deleted so that history stays intact. Records may
          be voided or superseded, and the superseded version is kept.
        </p>
        <p>
          <strong>OctaPM is a record-keeping tool, not a substitute for your
          contract.</strong> Whether a notice, claim or certificate is valid is
          determined by your contract and the applicable law, not by the
          platform.
        </p>
      </>
    ),
  },
  {
    id: 'acceptable-use',
    heading: 'Acceptable use',
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Use the platform unlawfully or to infringe anyone's rights.</li>
          <li>
            Attempt to access another organisation's data, or probe, scan or
            test the security of the platform without our written permission.
          </li>
          <li>
            Upload malicious code, or content you have no right to distribute.
          </li>
          <li>
            Resell or provide the platform as a service to a third party unless
            your agreement with us permits it.
          </li>
          <li>
            Use automated means to extract data at a scale that degrades the
            service for others.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'availability',
    heading: 'Availability and changes',
    body: (
      <>
        <p>
          We work to keep OctaPM available and performing well, but we do not
          promise uninterrupted service. Maintenance, third-party outages and
          faults happen; where a written service level applies, it governs.
        </p>
        <p>
          We improve the platform continuously. We will not remove a material
          capability your organisation depends on without reasonable notice.
        </p>
      </>
    ),
  },
  {
    id: 'ai',
    heading: 'AI-assisted features',
    body: (
      <>
        <p>
          Some features draft or suggest content — RFI responses, daily report
          drafts, schedule and cost commentary, document summaries. These are
          drafts for a person to review, never decisions.
        </p>
        <p>
          <strong>Always review AI-assisted output before relying on it or
          issuing it.</strong> You remain responsible for anything you approve,
          submit or send.
        </p>
      </>
    ),
  },
  {
    id: 'fees',
    heading: 'Fees, billing and trials',
    body: (
      <>
        <p>
          Paid plans are billed in advance for the period you select. Unless
          your written agreement says otherwise, fees are non-refundable for a
          period already begun, and subscriptions renew automatically until
          cancelled.
        </p>
        <p>
          We will give reasonable notice before a price change affecting your
          renewal. If a trial is offered, its terms are stated when you start
          it.
        </p>
      </>
    ),
  },
  {
    id: 'termination',
    heading: 'Termination and getting your data back',
    body: (
      <>
        <p>
          Either party may end the agreement in line with the plan or written
          agreement in force. We may suspend access for non-payment or for a
          serious breach of these terms, and we will tell you why.
        </p>
        <p>
          <strong>Export your data before you leave.</strong> The platform
          provides exports throughout your subscription. For a period after
          termination we will make a reasonable effort to provide an export on
          request; after that, data may be deleted in line with our retention
          practices.
        </p>
      </>
    ),
  },
  {
    id: 'warranties',
    heading: 'Warranties and disclaimers',
    body: (
      <>
        <p>
          We provide the platform with reasonable skill and care. Beyond that,
          and to the extent the law allows, the platform is provided as is: we
          do not warrant that it will be error-free, or that the calculations,
          forecasts and reports it produces will be accurate for every purpose.
        </p>
        <p>
          Earned value, forecasting, critical path and cost figures depend
          entirely on the data entered. Verify anything you rely on
          commercially.
        </p>
      </>
    ),
  },
  {
    id: 'liability',
    heading: 'Limitation of liability',
    body: (
      <>
        <p>
          To the extent permitted by law, neither party is liable for indirect
          or consequential loss, loss of profit, loss of contract, or loss of
          anticipated savings arising from these terms.
        </p>
        <p>
          Our total aggregate liability is limited to the fees paid by your
          organisation in the twelve months before the event giving rise to the
          claim.
        </p>
        <p>
          Nothing limits liability for death or personal injury caused by
          negligence, for fraud, or for anything that cannot lawfully be
          limited.
        </p>
      </>
    ),
  },
  {
    id: 'changes',
    heading: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. For material changes we will give notice
        through the platform or by email before they take effect. Continuing to
        use OctaPM after that date means you accept the updated terms.
      </p>
    ),
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: (
      <p>
        Questions about these terms can be sent to your OctaPM account contact
        or to the address published at octapm.com.
      </p>
    ),
  },
]

export function TermsPage() {
  return (
    <LegalDocument
      title='Terms of Service'
      summary='The terms on which your organisation uses OctaPM to plan, run and report on construction projects.'
      effectiveDate={EFFECTIVE}
      notice={<LegalReviewNotice />}
      sections={SECTIONS}
    />
  )
}
