import { useEffect } from "react";
import { Card, Logo } from "../components/Card";
import styles from "./TermsPage.module.css";

function useTelegram() {
  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);
}

function Section({ id, title, children }) {
  return (
    <section className={styles.section} id={id}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

function Para({ children }) {
  return <p className={styles.para}>{children}</p>;
}

function SubHeading({ children }) {
  return <p className={styles.subheading}>{children}</p>;
}

function Ul({ items }) {
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export default function TermsPage() {
  useTelegram();

  return (
    <Card align="left">
      <Logo>⚡</Logo>

      <div className={styles.header}>
        <h1 className={styles.title}>Terms of Use</h1>
        <p className={styles.meta}>
          EVS Electricity Top-Up Bot · Last updated: May 2026
        </p>
        <Para>
          Please read these Terms carefully before using the EVS Electricity
          Top-Up Bot ("the Bot"). By using the Bot, you agree to be bound by
          these Terms. If you do not agree, do not use the Bot.
        </Para>
      </div>

      <Section id="s1" title="1. Service overview">
        <Para>
          The Bot is an unofficial, independently developed tool that enables
          NUS hostel residents to check their EVS electricity meter balance and
          top up their meters via credit card through Telegram. It is not
          affiliated with, endorsed by, or operated by NUS, EVS, eNETS, or any
          payment network.
        </Para>
      </Section>

      <Section id="s2" title="2. Eligibility">
        <Para>You may use the Bot only if you:</Para>
        <Ul
          items={[
            "Are a current resident of a supported NUS hostel (PGPR, Houses @ PGP, Residential Colleges, NUS College, UTown Residence, or RVRC);",
            "Hold a valid EVS electricity meter registered to your hostel unit; and",
            "Are authorised to make payments for that meter.",
          ]}
        />
      </Section>

      <Section id="s3" title="3. Payment terms">
        <Para>
          <strong>Top-up amounts</strong> are subject to a minimum of SGD $6.00
          and a maximum of SGD $50.00 per transaction.
        </Para>
        <Para>
          <strong>Card payments</strong> are processed through eNETS. By
          initiating a payment, you authorise the charge to your credit card and
          agree to eNETS' payment terms and conditions.
        </Para>
        <Para>
          <strong>No refunds</strong> are guaranteed through this Bot. Once a
          top-up is successfully submitted to the EVS system, it cannot be
          reversed through this service. For disputes, contact EVS or your card
          issuer directly.
        </Para>
        <SubHeading>Failed transactions.</SubHeading>
        <Para>
          If a payment is declined or the process fails partway through, a
          charge may not be applied. However, some card issuers may place a
          temporary pre-authorisation hold even when a transaction does not
          complete. In the event of any technical failure mid-flow, verify the
          outcome with your card issuer and EVS before retrying.
        </Para>
        <SubHeading>Session loss during payment.</SubHeading>
        <Para>
          If the service restarts while your payment is in progress, your
          session may be lost and the result page may become inaccessible. If
          you do not receive a payment confirmation through the Bot, verify the
          outcome directly with your card issuer and EVS before retrying, to
          avoid being charged twice.
        </Para>
        <SubHeading>Top-up not reflected on meter.</SubHeading>
        <Para>
          If your payment is confirmed by your card issuer but the top-up does
          not appear on your meter, the Bot operator has no ability to
          investigate or resolve this. You must contact EVS directly with your
          transaction reference number. Do not retry the payment until the
          original transaction has been clarified, to avoid being charged twice.
        </Para>
        <SubHeading>
          Electricity or air conditioning not functioning after top-up.
        </SubHeading>
        <Para>
          The Bot is solely a payment interface. It has no control over meter
          activation, electricity delivery, air conditioning operation, or any
          hostel infrastructure. If your electricity or air conditioning does
          not function after a successful top-up, contact your hostel management
          office or EVS directly. This is entirely outside the scope of this
          service and the Bot operator bears no responsibility.
        </Para>
      </Section>

      <Section id="s4" title="4. Card security">
        <Para>
          Your card details are <strong>RSA-encrypted in your browser</strong>{" "}
          before transmission. The Bot's server never receives or stores your
          plaintext card number or CVV. Despite this, you use this service at
          your own risk. We make no warranties about the security of third-party
          systems (eNETS, EVS) involved in processing your payment.
        </Para>
      </Section>

      <Section id="s5" title="5. Meter identity and system routing">
        <Para>
          You are responsible for entering the correct 8-digit meter ID. Topping
          up the wrong meter is your sole responsibility. The Bot includes a
          cross-system guard for cp2nus users that rejects meters belonging to
          the cp2 system before payment is initiated, but this check is not
          infallible. If you are unsure which system your meter belongs to,
          verify with your hostel management.
        </Para>
        <SubHeading>Meter ID not found.</SubHeading>
        <Para>
          If your meter ID cannot be located in the EVS system, the Bot will not
          be able to proceed with a top-up. This may occur for newly assigned
          units, recently transferred residents, or due to delays in the EVS
          system. Verify your meter ID with your hostel management office before
          retrying. The Bot operator cannot manually look up, register, or
          resolve meter ID issues on your behalf.
        </Para>
      </Section>

      <Section id="s6" title="6. Session and data handling">
        <Ul
          items={[
            "Your meter ID and hostel selection are saved to a local database so you do not need to re-enter them on future top-ups. You can delete this at any time with the /forget command.",
            "Bot sessions (conversation state, current top-up stage) are held in memory only and expire after 15 minutes of inactivity. They are not written to disk and are lost on service restart.",
            "Payment sessions (eNETS keys, transaction state) are held in memory only and expire after 10 minutes. They are not written to disk and are lost on service restart.",
            "To support feedback replies, message routing information is held in memory for up to 7 days after a feedback submission. This consists only of Telegram message and chat identifiers; no message content is retained beyond what Telegram itself stores.",
            "Basic analytics events are captured to maintain service quality. These include transaction metadata such as meter ID, top-up amount, and outcome, but never your card details.",
            "By submitting feedback via /feedback, you consent to your message being forwarded to the Bot operator and to receiving a reply from the Bot operator through the Bot.",
          ]}
        />
      </Section>

      <Section id="s7" title="7. Operator communication">
        <Para>
          When you submit feedback, the Bot operator may reply to you directly
          through the Bot. These replies are sent via Telegram and will appear
          as messages from the Bot. You may also reply to those messages and
          your reply will be forwarded to the operator. This two-way exchange is
          limited to feedback threads and is not used for any other purpose.
        </Para>
      </Section>

      <Section id="s8" title="8. Availability and accuracy">
        <Para>
          The Bot depends on third-party systems (EVS WebPOS, EVS JSON API,
          eNETS) that may change or become unavailable without notice. We do not
          guarantee uninterrupted service, accurate balance data, or successful
          payment processing at any given time.
        </Para>
        <Para>
          Balance and usage figures displayed are fetched from the ORE API and
          may not reflect real-time meter readings.
        </Para>
      </Section>

      <Section id="s9" title="9. Prohibited use">
        <Para>You must not:</Para>
        <Ul
          items={[
            "Use the Bot to top up a meter you are not authorised to pay for;",
            "Attempt to reverse-engineer, scrape, abuse, or disrupt the Bot or any connected system;",
            "Submit false, fraudulent, or stolen payment credentials; or",
            "Circumvent any security or validation measure in the Bot.",
          ]}
        />
      </Section>

      <Section id="s10" title="10. Disclaimer of warranties">
        <Para>
          The Bot is provided <strong>"as is"</strong> without warranties of any
          kind, express or implied. We do not warrant that the Bot will be
          error-free, that payments will succeed, or that meter balances
          displayed will be accurate.
        </Para>
      </Section>

      <Section id="s11" title="11. Limitation of liability">
        <Para>
          To the fullest extent permitted by law, the Bot operator shall not be
          liable for any direct, indirect, incidental, or consequential loss
          arising from your use of the Bot, including but not limited to failed
          or duplicate payments, incorrect meter top-ups, or third-party system
          errors.
        </Para>
      </Section>

      <Section id="s12" title="12. Changes to these terms">
        <Para>
          These Terms may be updated at any time. Continued use of the Bot after
          changes constitutes acceptance of the revised Terms.
        </Para>
      </Section>

      <Section id="s13" title="13. Contact">
        <Para>
          For issues, disputes, or feedback, use the{" "}
          <code className={styles.code}>/feedback</code> command within the Bot.
        </Para>
      </Section>
    </Card>
  );
}
