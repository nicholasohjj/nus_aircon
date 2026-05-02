# Terms of Use

**EVS Electricity Top-Up Bot**
Last updated: April 2026

Please read these Terms of Use ("Terms") carefully before using the EVS Electricity Top-Up Bot ("the Bot"). By using the Bot, you agree to be bound by these Terms. If you do not agree, do not use the Bot.

---

## 1. Service Overview

The Bot is an unofficial, independently developed tool that enables NUS hostel residents to check their EVS electricity meter balance and top up their meters via credit card through Telegram. It is not affiliated with, endorsed by, or operated by NUS, EVS, eNETS, or any payment network.

---

## 2. Eligibility

You may use the Bot only if you:

- Are a current resident of a supported NUS hostel (PGPR, Houses @ PGP, Residential Colleges, NUS College, UTown Residence, or RVRC);
- Hold a valid EVS electricity meter registered to your hostel unit; and
- Are authorised to make payments for that meter.

---

## 3. Payment Terms

**Top-up amounts** are subject to a minimum of SGD $6.00 and a maximum of SGD $50.00 per transaction.

**Card payments** are processed through eNETS. By initiating a payment, you authorise the charge to your credit card and agree to eNETS' payment terms and conditions.

**No refunds** are guaranteed through this Bot. Once a top-up is successfully submitted to the EVS system, it cannot be reversed through this service. For disputes, contact EVS or your card issuer directly.

**Failed transactions.** If a payment is declined or the process fails partway through, a charge is generally not applied. However, some card issuers may place a temporary pre-authorisation hold even when a transaction does not complete. In the event of any technical failure mid-flow, verify the outcome with your card issuer and EVS before retrying.

**Top-up not reflected on meter.** If your payment is confirmed by your card issuer but the top-up does not appear on your meter, the Bot operator has no ability to investigate or resolve this. You must contact EVS directly with your transaction reference number. Do not retry the payment until the original transaction has been clarified, to avoid being charged twice.

**Electricity or air conditioning not functioning after top-up.** The Bot is solely a payment interface. It has no control over meter activation, electricity delivery, air conditioning operation, or any hostel infrastructure. If your electricity or air conditioning does not function after a successful top-up, contact your hostel management office or EVS directly. This is entirely outside the scope of this service and the Bot operator bears no responsibility.

---

## 4. Card Security

Your card details are **RSA-encrypted in your browser** before transmission. The Bot's server never receives or stores your plaintext card number or CVV. Despite this, you use this service at your own risk. We make no warranties about the security of third-party systems (eNETS, EVS) involved in processing your payment.

---

## 5. Meter Identity and System Routing

You are responsible for entering the correct 8-digit meter ID. Topping up the wrong meter is your sole responsibility. The Bot includes a cross-system guard for cp2nus users that rejects meters belonging to the cp2 system before payment is initiated, but this check is not infallible. If you are unsure which system your meter belongs to, verify with your hostel management.

**Meter ID not found.** If your meter ID cannot be located in the EVS system, the Bot will not be able to proceed with a top-up. This may occur for newly assigned units, recently transferred residents, or due to delays in the EVS system. Verify your meter ID with your hostel management office before retrying. The Bot operator cannot manually look up, register, or resolve meter ID issues on your behalf.

---

## 6. Session and Data Handling

- Bot sessions are stored **in memory only** and expire after 15 minutes of inactivity. No conversation history or meter IDs are persisted to disk.
- To support feedback replies (see below), message routing information is held in memory for up to **7 days** after a feedback submission. This consists only of Telegram message and chat identifiers; no message content is retained beyond what Telegram itself stores.
- Basic analytics events and error details are captured to maintain service quality. These do not include your card details.
- By submitting feedback via `/feedback`, you consent to your message being forwarded to the Bot operator and to receiving a reply from the Bot operator through the Bot.

---

## 7. Operator Communication

When you submit feedback, the Bot operator may reply to you directly through the Bot. These replies are sent via Telegram and will appear as messages from the Bot. You may also reply to those messages and your reply will be forwarded to the operator. This two-way exchange is limited to feedback threads and is not used for any other purpose.

---

## 8. Availability and Accuracy

The Bot depends on third-party systems (EVS WebPOS, EVS JSON API, eNETS) that may change or become unavailable without notice. We do not guarantee uninterrupted service, accurate balance data, or successful payment processing at any given time.

Balance and usage figures displayed are fetched from the ORE API and may not reflect real-time meter readings.

---

## 9. Prohibited Use

You must not:

- Use the Bot to top up a meter you are not authorised to pay for;
- Attempt to reverse-engineer, scrape, abuse, or disrupt the Bot or any connected system;
- Submit false, fraudulent, or stolen payment credentials; or
- Circumvent any security or validation measure in the Bot.

---

## 10. Disclaimer of Warranties

The Bot is provided **"as is"** without warranties of any kind, express or implied. We do not warrant that the Bot will be error-free, that payments will succeed, or that meter balances displayed will be accurate.

---

## 11. Limitation of Liability

To the fullest extent permitted by law, the Bot operator shall not be liable for any direct, indirect, incidental, or consequential loss arising from your use of the Bot, including but not limited to failed or duplicate payments, incorrect meter top-ups, or third-party system errors.

---

## 12. Changes to These Terms

These Terms may be updated at any time. Continued use of the Bot after changes constitutes acceptance of the revised Terms.

---

## 13. Contact

For issues, disputes, or feedback, use the `/feedback` command within the Bot.