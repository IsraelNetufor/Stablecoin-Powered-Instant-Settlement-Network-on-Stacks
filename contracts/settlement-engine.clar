;; settlement-engine.clar

(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-RECEIVER u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-TOKEN u103)
(define-constant ERR-SETTLEMENT-ALREADY-EXISTS u104)
(define-constant ERR-SETTLEMENT-NOT-FOUND u105)
(define-constant ERR-INVALID-STATUS u106)
(define-constant ERR-INVALID-TIMESTAMP u107)
(define-constant ERR-VAULT-NOT-SET u108)
(define-constant ERR-ESCROW-NOT-SET u109)
(define-constant ERR-FEE-NOT-SET u110)
(define-constant ERR-ORACLE-NOT-SET u111)
(define-constant ERR-INSUFFICIENT-BALANCE u112)
(define-constant ERR-TRANSFER-FAILED u113)
(define-constant ERR-CONFIRMATION-REQUIRED u114)
(define-constant ERR-CANCEL-NOT-ALLOWED u115)
(define-constant ERR-TIMEOUT-EXCEEDED u116)
(define-constant ERR-PEG-VALIDATION-FAILED u117)
(define-constant ERR-INVALID-FEE-RATE u118)
(define-constant ERR-MAX-SETTLEMENTS-EXCEEDED u119)
(define-constant ERR-INVALID-DISPUTE-REASON u120)

(define-data-var next-settlement-id uint u0)
(define-data-var max-settlements uint u10000)
(define-data-var settlement-timeout uint u144)
(define-data-var vault-contract (optional principal) none)
(define-data-var escrow-contract (optional principal) none)
(define-data-var fee-contract (optional principal) none)
(define-data-var oracle-contract (optional principal) none)
(define-data-var admin-principal principal tx-sender)

(define-map settlements
  uint
  {
    sender: principal,
    receiver: principal,
    amount: uint,
    stable-token: principal,
    status: uint,
    timestamp: uint,
    fee-amount: uint,
    dispute-reason: (optional (string-utf8 200)),
    confirmed: bool
  }
)

(define-map settlements-by-sender
  principal
  (list 100 uint))

(define-map settlements-by-receiver
  principal
  (list 100 uint))

(define-read-only (get-settlement (id uint))
  (map-get? settlements id)
)

(define-read-only (get-settlements-by-sender (sender principal))
  (map-get? settlements-by-sender sender)
)

(define-read-only (get-settlements-by-receiver (receiver principal))
  (map-get? settlements-by-receiver receiver)
)

(define-read-only (get-next-settlement-id)
  (var-get next-settlement-id)
)

(define-private (validate-receiver (receiver principal))
  (if (not (is-eq receiver tx-sender))
    (ok true)
    (err ERR-INVALID-RECEIVER))
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-AMOUNT))
)

(define-private (validate-token (token principal))
  (if (is-eq token 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token)
    (ok true)
    (err ERR-INVALID-TOKEN))
)

(define-private (validate-status (status uint))
  (if (or (is-eq status u0) (is-eq status u1) (is-eq status u2) (is-eq status u3))
    (ok true)
    (err ERR-INVALID-STATUS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-dispute-reason (reason (optional (string-utf8 200))))
  (match reason
    r (if (<= (len r) u200)
        (ok true)
        (err ERR-INVALID-DISPUTE-REASON))
    (ok true))
)

(define-private (is-admin (caller principal))
  (is-eq caller (var-get admin-principal))
)

(define-public (set-vault-contract (contract principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set vault-contract (some contract))
    (ok true)
  )
)

(define-public (set-escrow-contract (contract principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set escrow-contract (some contract))
    (ok true)
  )
)

(define-public (set-fee-contract (contract principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set fee-contract (some contract))
    (ok true)
  )
)

(define-public (set-oracle-contract (contract principal))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-contract (some contract))
    (ok true)
  )
)

(define-public (set-settlement-timeout (new-timeout uint))
  (begin
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (> new-timeout u0) (err ERR-INVALID-TIMESTAMP))
    (var-set settlement-timeout new-timeout)
    (ok true)
  )
)

(define-public (init-settlement (receiver principal) (amount uint) (stable-token principal))
  (let (
    (next-id (var-get next-settlement-id))
    (current-max (var-get max-settlements))
    (vault (unwrap! (var-get vault-contract) (err ERR-VAULT-NOT-SET)))
    (oracle (unwrap! (var-get oracle-contract) (err ERR-ORACLE-NOT-SET)))
    (fee (unwrap! (var-get fee-contract) (err ERR-FEE-NOT-SET)))
    (fee-amount (unwrap! (contract-call? fee collect-fee amount) (err ERR-TRANSFER-FAILED)))
    (net-amount (- amount fee-amount))
  )
    (asserts! (< next-id current-max) (err ERR-MAX-SETTLEMENTS-EXCEEDED))
    (try! (validate-receiver receiver))
    (try! (validate-amount amount))
    (try! (validate-token stable-token))
    (try! (contract-call? oracle validate-peg "USD"))
    (try! (contract-call? vault deposit-stable stable-token amount))
    (map-set settlements next-id
      {
        sender: tx-sender,
        receiver: receiver,
        amount: net-amount,
        stable-token: stable-token,
        status: u0,
        timestamp: block-height,
        fee-amount: fee-amount,
        dispute-reason: none,
        confirmed: false
      }
    )
    (map-set settlements-by-sender tx-sender
      (unwrap! (as-max-len? (append (default-to (list) (map-get? settlements-by-sender tx-sender)) next-id) u100) (err ERR-MAX-SETTLEMENTS-EXCEEDED))
    )
    (map-set settlements-by-receiver receiver
      (unwrap! (as-max-len? (append (default-to (list) (map-get? settlements-by-receiver receiver)) next-id) u100) (err ERR-MAX-SETTLEMENTS-EXCEEDED))
    )
    (var-set next-settlement-id (+ next-id u1))
    (print { event: "settlement-initiated", id: next-id })
    (ok next-id)
  )
)

(define-public (confirm-settlement (settlement-id uint))
  (let ((settlement (unwrap! (map-get? settlements settlement-id) (err ERR-SETTLEMENT-NOT-FOUND))))
    (asserts! (is-eq (get receiver settlement) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status settlement) u0) (err ERR-INVALID-STATUS))
    (asserts! (get confirmed settlement) (err ERR-CONFIRMATION-REQUIRED))
    (map-set settlements settlement-id
      (merge settlement { confirmed: true })
    )
    (print { event: "settlement-confirmed", id: settlement-id })
    (ok true)
  )
)

(define-public (execute-transfer (settlement-id uint))
  (let (
    (settlement (unwrap! (map-get? settlements settlement-id) (err ERR-SETTLEMENT-NOT-FOUND)))
    (vault (unwrap! (var-get vault-contract) (err ERR-VAULT-NOT-SET)))
    (escrow (unwrap! (var-get escrow-contract) (err ERR-ESCROW-NOT-SET)))
  )
    (asserts! (or (is-eq (get sender settlement) tx-sender) (is-eq (get receiver settlement) tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status settlement) u0) (err ERR-INVALID-STATUS))
    (asserts! (<= (+ (get timestamp settlement) (var-get settlement-timeout)) block-height) (err ERR-TIMEOUT-EXCEEDED))
    (if (is-some (get dispute-reason settlement))
      (try! (contract-call? escrow escrow-funds settlement-id))
      (try! (contract-call? vault withdraw-stable (get stable-token settlement) (get receiver settlement) (get amount settlement)))
    )
    (map-set settlements settlement-id
      (merge settlement { status: u1 })
    )
    (print { event: "settlement-executed", id: settlement-id })
    (ok true)
  )
)

(define-public (cancel-settlement (settlement-id uint))
  (let (
    (settlement (unwrap! (map-get? settlements settlement-id) (err ERR-SETTLEMENT-NOT-FOUND)))
    (vault (unwrap! (var-get vault-contract) (err ERR-VAULT-NOT-SET)))
  )
    (asserts! (is-eq (get sender settlement) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status settlement) u0) (err ERR-INVALID-STATUS))
    (asserts! (not (get confirmed settlement)) (err ERR-CANCEL-NOT-ALLOWED))
    (try! (contract-call? vault withdraw-stable (get stable-token settlement) tx-sender (get amount settlement)))
    (map-set settlements settlement-id
      (merge settlement { status: u2 })
    )
    (print { event: "settlement-cancelled", id: settlement-id })
    (ok true)
  )
)

(define-public (dispute-settlement (settlement-id uint) (reason (string-utf8 200)))
  (let ((settlement (unwrap! (map-get? settlements settlement-id) (err ERR-SETTLEMENT-NOT-FOUND))))
    (asserts! (or (is-eq (get sender settlement) tx-sender) (is-eq (get receiver settlement) tx-sender)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status settlement) u0) (err ERR-INVALID-STATUS))
    (try! (validate-dispute-reason (some reason)))
    (map-set settlements settlement-id
      (merge settlement { dispute-reason: (some reason), status: u3 })
    )
    (print { event: "settlement-disputed", id: settlement-id })
    (ok true)
  )
)

(define-public (resolve-dispute (settlement-id uint) (resolve-to principal))
  (let (
    (settlement (unwrap! (map-get? settlements settlement-id) (err ERR-SETTLEMENT-NOT-FOUND)))
    (vault (unwrap! (var-get vault-contract) (err ERR-VAULT-NOT-SET)))
    (escrow (unwrap! (var-get escrow-contract) (err ERR-ESCROW-NOT-SET)))
  )
    (asserts! (is-admin tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status settlement) u3) (err ERR-INVALID-STATUS))
    (try! (contract-call? escrow release-escrow settlement-id))
    (try! (contract-call? vault withdraw-stable (get stable-token settlement) resolve-to (get amount settlement)))
    (map-set settlements settlement-id
      (merge settlement { status: u1 })
    )
    (print { event: "dispute-resolved", id: settlement-id })
    (ok true)
  )
)