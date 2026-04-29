;;; mediant-org-agenda.el --- Mediant recurrence exceptions in Org agenda -*- lexical-binding: t; -*-

;; Author: Mediant
;; Version: 0.1.0
;; Package-Requires: ((emacs "27.1") (org "9.5"))
;; Keywords: outlines, calendar

;;; Commentary:

;; This package makes Emacs Org agenda respect the Mediant recurrence
;; exception properties stored in ordinary Org property drawers:
;;
;;   :EXCEPTION-YYYY-MM-DD: cancelled
;;   :EXCEPTION-YYYY-MM-DD: shift +45m
;;   :EXCEPTION-YYYY-MM-DD: reschedule YYYY-MM-DD 18:00
;;   :EXCEPTION-NOTE-YYYY-MM-DD: Bring water
;;   :SERIES-UNTIL: YYYY-MM-DD
;;
;; Enable with:
;;
;;   (require 'mediant-org-agenda)
;;   (mediant-org-agenda-mode 1)
;;
;; The integration is intentionally an agenda finalization pass.  It reads
;; Org agenda line metadata, maps each generated recurrence occurrence back
;; to its unshifted base date, and then filters or moves the displayed line.

;;; Code:

(require 'calendar)
(require 'cl-lib)
(require 'org)
(require 'org-agenda)
(require 'subr-x)

(defgroup mediant-org-agenda nil
  "Display Mediant recurrence exception properties in Org agenda."
  :group 'org-agenda
  :prefix "mediant-org-agenda-")

(defcustom mediant-org-agenda-enable-exceptions t
  "When non-nil, apply EXCEPTION-* properties in Org agenda."
  :type 'boolean
  :group 'mediant-org-agenda)

(defcustom mediant-org-agenda-enable-series-until t
  "When non-nil, apply SERIES-UNTIL as an exclusive recurrence end date."
  :type 'boolean
  :group 'mediant-org-agenda)

(defcustom mediant-org-agenda-show-notes t
  "When non-nil, show EXCEPTION-NOTE-* text under matching agenda items."
  :type 'boolean
  :group 'mediant-org-agenda)

(defcustom mediant-org-agenda-note-prefix "  - "
  "Prefix used for rendered Mediant exception note lines."
  :type 'string
  :group 'mediant-org-agenda)

(defcustom mediant-org-agenda-debug nil
  "When non-nil, log Mediant agenda processing decisions."
  :type 'boolean
  :group 'mediant-org-agenda)

(defcustom mediant-org-agenda-moved-prefix "Moved: "
  "Prefix added to moved synthetic agenda lines."
  :type 'string
  :group 'mediant-org-agenda)

(defface mediant-org-agenda-note
  '((t :inherit shadow :slant italic))
  "Face used for rendered Mediant exception note lines."
  :group 'mediant-org-agenda)

(defface mediant-org-agenda-moved
  '((t :inherit default))
  "Face used for moved Mediant synthetic agenda lines."
  :group 'mediant-org-agenda)

(defun mediant-org-agenda--log (fmt &rest args)
  "Log FMT with ARGS when `mediant-org-agenda-debug' is non-nil."
  (when mediant-org-agenda-debug
    (apply #'message (concat "[mediant-org-agenda] " fmt) args)))

(defun mediant-org-agenda--valid-date-p (date)
  "Return non-nil when DATE is an ISO YYYY-MM-DD date."
  (and (stringp date)
       (string-match-p "\\`[0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\'" date)
       (condition-case nil
           (progn
             (mediant-org-agenda--iso-to-abs date)
             t)
         (error nil))))

(defun mediant-org-agenda--iso-to-abs (date)
  "Convert ISO YYYY-MM-DD DATE to an absolute calendar day."
  (unless (string-match "\\`\\([0-9]\\{4\\}\\)-\\([0-9]\\{2\\}\\)-\\([0-9]\\{2\\}\\)\\'" date)
    (error "Invalid ISO date: %S" date))
  (let* ((year (string-to-number (match-string 1 date)))
         (month (string-to-number (match-string 2 date)))
         (day (string-to-number (match-string 3 date)))
         (abs (calendar-absolute-from-gregorian (list month day year)))
         (roundtrip (calendar-gregorian-from-absolute abs)))
    (unless (and (= month (nth 0 roundtrip))
                 (= day (nth 1 roundtrip))
                 (= year (nth 2 roundtrip)))
      (error "Invalid ISO date: %S" date))
    abs))

(defun mediant-org-agenda--abs-to-iso (abs-day)
  "Convert ABS-DAY to ISO YYYY-MM-DD."
  (pcase-let ((`(,month ,day ,year) (calendar-gregorian-from-absolute abs-day)))
    (format "%04d-%02d-%02d" year month day)))

(defun mediant-org-agenda--date-prop-to-abs (date)
  "Normalize Org agenda DATE text property to an absolute day."
  (cond
   ((integerp date) date)
   ((and (listp date) (= (length date) 3))
    (calendar-absolute-from-gregorian date))
   (t nil)))

(defun mediant-org-agenda--time-to-minutes (time)
  "Return minutes after midnight for HH:MM TIME, or nil."
  (when (and (stringp time)
             (string-match "\\`\\([0-2][0-9]\\):\\([0-5][0-9]\\)\\'" time))
    (+ (* 60 (string-to-number (match-string 1 time)))
       (string-to-number (match-string 2 time)))))

(defun mediant-org-agenda--minutes-to-time (minutes)
  "Return HH:MM for MINUTES after midnight."
  (format "%02d:%02d" (/ minutes 60) (% minutes 60)))

(defun mediant-org-agenda-parse-exception-value (value)
  "Parse EXCEPTION property VALUE.
Return a plist describing the override, or nil for invalid values."
  (let ((trimmed (string-trim (or value ""))))
    (cond
     ((string= trimmed "cancelled")
      '(:kind cancelled))
     ((string-match "\\`shift \\([+-][0-9]+\\)\\([mhd]\\)\\'" trimmed)
      (let ((amount (string-to-number (match-string 1 trimmed)))
            (unit (pcase (match-string 2 trimmed)
                    ("m" 'minute)
                    ("h" 'hour)
                    ("d" 'day))))
        (list :kind 'shift :amount amount :unit unit)))
     ((string-match "\\`reschedule \\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)\\(?: \\([0-2][0-9]:[0-5][0-9]\\)\\(?:-\\([0-2][0-9]:[0-5][0-9]\\)\\)?\\)?\\'" trimmed)
      (let ((date (match-string 1 trimmed))
            (start (match-string 2 trimmed))
            (end (match-string 3 trimmed)))
        (when (and (mediant-org-agenda--valid-date-p date)
                   (or (not start) (mediant-org-agenda--time-to-minutes start))
                   (or (not end) (mediant-org-agenda--time-to-minutes end)))
          (list :kind 'reschedule :date date :start start :end end))))
     (t nil))))

(defun mediant-org-agenda--merge-exception (exceptions date key value)
  "Set DATE KEY to VALUE in EXCEPTIONS alist and return EXCEPTIONS."
  (let ((cell (assoc date exceptions)))
    (unless cell
      (setq cell (cons date nil))
      (push cell exceptions))
    (setcdr cell (plist-put (cdr cell) key value))
    exceptions))

(defun mediant-org-agenda-read-exceptions (&optional marker)
  "Read Mediant exception properties at MARKER.
Return an alist keyed by base ISO date.  Each cdr is a plist with
`:override' and/or `:note'."
  (let ((exceptions nil))
    (dolist (prop (mediant-org-agenda--entry-property-pairs marker))
      (let ((name (car prop))
            (value (cdr prop)))
        (cond
         ((string-match "\\`EXCEPTION-\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)\\'" name)
          (let* ((date (match-string 1 name))
                 (override (and (mediant-org-agenda--valid-date-p date)
                                (mediant-org-agenda-parse-exception-value value))))
            (when override
              (setq exceptions
                    (mediant-org-agenda--merge-exception exceptions date :override override)))))
         ((string-match "\\`EXCEPTION-NOTE-\\([0-9]\\{4\\}-[0-9]\\{2\\}-[0-9]\\{2\\}\\)\\'" name)
          (let ((date (match-string 1 name))
                (note (string-trim (or value ""))))
            (when (and (mediant-org-agenda--valid-date-p date)
                       (not (string-empty-p note)))
              (setq exceptions
                    (mediant-org-agenda--merge-exception exceptions date :note note))))))))
    exceptions))

(defun mediant-org-agenda-read-series-until (&optional marker)
  "Read SERIES-UNTIL at MARKER.
Return an ISO date string or nil."
  (cdr (cl-find-if
        (lambda (prop)
          (and (string= (car prop) "SERIES-UNTIL")
               (mediant-org-agenda--valid-date-p (string-trim (cdr prop)))))
        (mediant-org-agenda--entry-property-pairs marker))))

(defun mediant-org-agenda--entry-property-pairs (&optional marker)
  "Return raw PROPERTIES drawer pairs for the entry at MARKER.
Unlike `org-entry-properties', this scans any PROPERTIES drawer in
the entry body so it can read drawers produced by Mediant after a
bare active timestamp."
  (let ((pairs nil))
    (when (and marker (marker-buffer marker))
      (with-current-buffer (marker-buffer marker)
        (save-excursion
          (goto-char marker)
          (when (org-before-first-heading-p)
            (user-error "Mediant marker is before first Org heading"))
          (org-back-to-heading t)
          (let ((end (save-excursion (or (outline-next-heading) (point-max))))
                (in-properties nil))
            (forward-line 1)
            (while (< (point) end)
              (cond
               ((and (not in-properties)
                     (looking-at-p "^[ \t]*:PROPERTIES:[ \t]*$"))
                (setq in-properties t))
               ((and in-properties
                     (looking-at-p "^[ \t]*:END:[ \t]*$"))
                (setq in-properties nil))
               ((and in-properties
                     (looking-at "^[ \t]*:\\([^:\n]+\\):[ \t]*\\(.*?\\)[ \t]*$"))
                (push (cons (upcase (match-string 1))
                            (match-string 2))
                      pairs)))
              (forward-line 1))))))
    (nreverse pairs)))

(defun mediant-org-agenda--line-property (prop)
  "Return text property PROP from anywhere on the current agenda line."
  (or (get-text-property (point) prop)
      (let ((pos (line-beginning-position))
            (end (line-end-position))
            value)
        (while (and (< pos end) (not value))
          (setq value (get-text-property pos prop))
          (setq pos (next-single-property-change pos prop nil end)))
        value)))

(defun mediant-org-agenda--line-marker ()
  "Return the Org marker for the current agenda line, or nil."
  (or (mediant-org-agenda--line-property 'org-hd-marker)
      (mediant-org-agenda--line-property 'org-marker)))

(defun mediant-org-agenda--line-date ()
  "Return the agenda line absolute date at point, or nil."
  (mediant-org-agenda--date-prop-to-abs
   (or (mediant-org-agenda--line-property 'date)
       (mediant-org-agenda--line-property 'ts-date)
       (mediant-org-agenda--line-property 'day))))

(defun mediant-org-agenda--line-time-minutes ()
  "Return the agenda line time in minutes after midnight, or nil."
  (let ((tod (mediant-org-agenda--line-property 'time-of-day)))
    (when (integerp tod)
      (+ (* 60 (/ tod 100)) (% tod 100)))))

(defun mediant-org-agenda--recurring-line-p ()
  "Return non-nil if the current agenda line came from a repeating timestamp."
  (let ((marker (mediant-org-agenda--line-property 'org-marker)))
    (when (and marker (marker-buffer marker))
      (with-current-buffer (marker-buffer marker)
        (save-excursion
          (goto-char marker)
          (let ((line-end (line-end-position)))
            (re-search-forward "\\(?:\\.\\+\\|\\+\\+\\|\\+\\)[0-9]+[dwmy]" line-end t)))))))

(defun mediant-org-agenda--shift-target (base-abs base-min override)
  "Return target plist for shift OVERRIDE from BASE-ABS and BASE-MIN."
  (let* ((amount (plist-get override :amount))
         (unit (plist-get override :unit))
         (delta-min (pcase unit
                      ('minute amount)
                      ('hour (* amount 60))
                      ('day (* amount 1440))))
         (start-min (or base-min 0))
         (total (+ start-min delta-min))
         (day-delta (floor total 1440))
         (minute (mod total 1440)))
    (list :date-abs (+ base-abs day-delta)
          :start (and base-min (mediant-org-agenda--minutes-to-time minute)))))

(defun mediant-org-agenda--target-for-override (base-abs base-min override)
  "Return target plist for OVERRIDE from BASE-ABS and BASE-MIN."
  (pcase (plist-get override :kind)
    ('shift
     (mediant-org-agenda--shift-target base-abs base-min override))
    ('reschedule
     (let* ((date (plist-get override :date))
            (start (plist-get override :start))
            (end (plist-get override :end))
            (target (list :date-abs (mediant-org-agenda--iso-to-abs date))))
       (when (or start base-min)
         (setq target (plist-put target :start (or start (mediant-org-agenda--minutes-to-time base-min)))))
       (when end
         (setq target (plist-put target :end end)))
       target))))

(defun mediant-org-agenda--replace-first-time (line start &optional end)
  "Replace first HH:MM in LINE with START and optional END.
If LINE has no visible time, prefix a compact START marker."
  (let ((time (if end (format "%s-%s" start end) start)))
    (cond
     ((not start) line)
     ((string-match "[0-2][0-9]:[0-5][0-9]\\(?:-[0-2][0-9]:[0-5][0-9]\\)?" line)
      (replace-match time t t line))
     (t (concat time "...... " line)))))

(defun mediant-org-agenda--make-moved-line (line target note)
  "Return a moved synthetic agenda LINE for TARGET and NOTE."
  (let* ((start (plist-get target :start))
         (end (plist-get target :end))
         (text (concat mediant-org-agenda-moved-prefix
                       (mediant-org-agenda--replace-first-time
                        (substring-no-properties line) start end))))
    (add-text-properties 0 (length text)
                         `(face mediant-org-agenda-moved
                                mediant-org-agenda-synthetic t)
                         text)
    (if (and mediant-org-agenda-show-notes note)
        (concat text "\n" (mediant-org-agenda--note-line note))
      text)))

(defun mediant-org-agenda--note-line (note)
  "Return a formatted agenda NOTE line."
  (let ((text (concat mediant-org-agenda-note-prefix note)))
    (add-text-properties 0 (length text) '(face mediant-org-agenda-note) text)
    text))

(defun mediant-org-agenda--delete-current-line ()
  "Delete current agenda line, including trailing newline if present."
  (delete-region (line-beginning-position)
                 (min (point-max) (1+ (line-end-position)))))

(defun mediant-org-agenda--insertions-by-date ()
  "Return an empty hash table keyed by absolute agenda day."
  (make-hash-table :test #'eql))

(defun mediant-org-agenda--push-insertion (table abs-day text)
  "Push TEXT into TABLE for ABS-DAY."
  (puthash abs-day (cons text (gethash abs-day table)) table))

(defun mediant-org-agenda--insert-moved-lines (table)
  "Insert moved synthetic lines from TABLE into agenda day sections."
  (maphash
   (lambda (abs-day lines)
     (let ((insert-pos nil))
       (save-excursion
         (goto-char (point-min))
         (while (and (not insert-pos) (not (eobp)))
           (if (equal (mediant-org-agenda--date-prop-to-abs
                       (get-text-property (point) 'day))
                      abs-day)
               (progn
                 (setq insert-pos (line-end-position))
                 (forward-line 1)
                 (while (and (not (eobp))
                             (not (and (mediant-org-agenda--date-prop-to-abs
                                         (get-text-property (point) 'day))
                                       (not (get-text-property (point) 'org-marker)))))
                   (setq insert-pos (line-end-position))
                   (forward-line 1)))
             (forward-line 1)))
         (when insert-pos
           (goto-char insert-pos)
           (end-of-line)
           (dolist (line (nreverse lines))
             (insert "\n" line))))))
   table))

(defun mediant-org-agenda--process-line (insertions)
  "Process current agenda line and add moved lines to INSERTIONS."
  (unless (get-text-property (point) 'mediant-org-agenda-synthetic)
    (let* ((marker (mediant-org-agenda--line-marker))
           (base-abs (mediant-org-agenda--line-date))
           (recurring (mediant-org-agenda--recurring-line-p)))
      (when (and marker base-abs recurring)
        (let* ((base-key (mediant-org-agenda--abs-to-iso base-abs))
               (exceptions (and mediant-org-agenda-enable-exceptions
                                (mediant-org-agenda-read-exceptions marker)))
               (series-until (and mediant-org-agenda-enable-series-until
                                  (mediant-org-agenda-read-series-until marker)))
               (exception (cdr (assoc base-key exceptions)))
               (override (plist-get exception :override))
               (note (plist-get exception :note))
               (delete-line nil))
          (when (and series-until
                     (>= base-abs (mediant-org-agenda--iso-to-abs series-until)))
            (setq delete-line t)
            (mediant-org-agenda--log "suppress %s at/after SERIES-UNTIL %s" base-key series-until))
          (when (and override (eq (plist-get override :kind) 'cancelled))
            (setq delete-line t)
            (mediant-org-agenda--log "suppress cancelled occurrence %s" base-key))
          (when (and override (memq (plist-get override :kind) '(shift reschedule))
                     (not delete-line))
            (let* ((line (buffer-substring (line-beginning-position) (line-end-position)))
                   (target (mediant-org-agenda--target-for-override
                            base-abs (mediant-org-agenda--line-time-minutes) override)))
              (mediant-org-agenda--push-insertion
               insertions
               (plist-get target :date-abs)
               (mediant-org-agenda--make-moved-line line target note))
              (setq delete-line t)
              (mediant-org-agenda--log "move occurrence %s to %s"
                                       base-key
                                       (mediant-org-agenda--abs-to-iso (plist-get target :date-abs)))))
          (cond
           (delete-line
            (mediant-org-agenda--delete-current-line)
            'deleted)
           ((and mediant-org-agenda-show-notes note)
            (end-of-line)
            (insert "\n" (mediant-org-agenda--note-line note))
            (forward-line 1)
            'kept)
           (t 'kept)))))))

(defun mediant-org-agenda-apply ()
  "Apply Mediant recurrence exceptions to the current Org agenda buffer."
  (when (derived-mode-p 'org-agenda-mode)
    (let ((insertions (mediant-org-agenda--insertions-by-date)))
      (save-excursion
        (goto-char (point-min))
        (while (not (eobp))
          (let ((result (mediant-org-agenda--process-line insertions)))
            (unless (eq result 'deleted)
              (forward-line 1)))))
      (mediant-org-agenda--insert-moved-lines insertions))))

;;;###autoload
(define-minor-mode mediant-org-agenda-mode
  "Toggle Mediant recurrence exception support in Org agenda."
  :global t
  :group 'mediant-org-agenda
  (if mediant-org-agenda-mode
      (add-hook 'org-agenda-finalize-hook #'mediant-org-agenda-apply)
    (remove-hook 'org-agenda-finalize-hook #'mediant-org-agenda-apply)))

(provide 'mediant-org-agenda)

;;; mediant-org-agenda.el ends here
