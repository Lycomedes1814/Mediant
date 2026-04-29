;;; mediant-org-agenda-test.el --- Tests for mediant-org-agenda -*- lexical-binding: t; -*-

;;; Code:

(require 'ert)
(require 'org)
(require 'org-agenda)
(require 'subr-x)
(require 'mediant-org-agenda)

(defun mediant-org-agenda-test--agenda-text (source start-day span)
  "Return Org agenda text for SOURCE from START-DAY spanning SPAN days."
  (let* ((file (make-temp-file "mediant-org-agenda-test" nil ".org" source))
         (org-agenda-files (list file))
         (org-agenda-span span)
         (org-agenda-start-day start-day)
         (org-agenda-use-time-grid nil)
         (org-agenda-show-all-dates t)
         (org-agenda-prefix-format "  %?-12t")
         (org-agenda-sorting-strategy '((agenda time-up priority-down category-keep)))
         (mediant-org-agenda-mode nil))
    (unwind-protect
        (progn
          (mediant-org-agenda-mode 1)
          (org-agenda-list nil)
          (with-current-buffer org-agenda-buffer-name
            (buffer-substring-no-properties (point-min) (point-max))))
      (mediant-org-agenda-mode -1)
      (when (get-buffer org-agenda-buffer-name)
        (kill-buffer org-agenda-buffer-name))
      (delete-file file))))

(defun mediant-org-agenda-test--count-matches (regexp text)
  "Return number of REGEXP matches in TEXT."
  (let ((count 0)
        (start 0))
    (while (string-match regexp text start)
      (setq count (1+ count))
      (setq start (match-end 0)))
    count))

(defun mediant-org-agenda-test--active-event (title properties &optional timestamp)
  "Return an Org active timestamp event TITLE with PROPERTIES.
TIMESTAMP defaults to a weekly 2026-04-21 17:00 timestamp."
  (concat
   "* " title "\n"
   ":PROPERTIES:\n"
   properties
   ":END:\n"
   (or timestamp "<2026-04-21 Tue 17:00 +1w>")
   "\n"))

(ert-deftest mediant-org-agenda-test-cancelled-recurring-occurrence-disappears ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: cancelled\n")
               "2026-04-20"
               10)))
    (should (= 1 (mediant-org-agenda-test--count-matches "17:00[.]+ Yoga" text)))
    (should (string-match-p "Tuesday    21 April 2026" text))
    (should (string-match-p "Tuesday    28 April 2026" text))))

(ert-deftest mediant-org-agenda-test-exception-note-renders-under-matching-occurrence ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-NOTE-2026-04-28: Bring water\n")
               "2026-04-28"
               1)))
    (should (string-match-p "17:00[.]+ Yoga" text))
    (should (string-match-p "  - Bring water" text))))

(ert-deftest mediant-org-agenda-test-shift-changes-visible-time ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: shift +45m\n")
               "2026-04-28"
               1)))
    (should-not (string-match-p "17:00[.]+ Yoga" text))
    (should (string-match-p "17:45[.]+ Yoga" text))
    (should (string-match-p "↪" text))))

(ert-deftest mediant-org-agenda-test-shift-across-midnight-moves-to-next-agenda-day ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Late Yoga"
                ":EXCEPTION-2026-04-28: shift +2h\n"
                "<2026-04-21 Tue 23:30 +1w>")
               "2026-04-28"
               2)))
    (should (string-match-p "Wednesday  29 April 2026" text))
    (should-not (string-match-p "23:30[.]+ Late Yoga" text))
    (should (string-match-p "01:30[.]+ Late Yoga" text))))

(ert-deftest mediant-org-agenda-test-reschedule-date-moves-occurrence ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: reschedule 2026-04-29\n")
               "2026-04-28"
               2)))
    (should (= 1 (mediant-org-agenda-test--count-matches "17:00[.]+ Yoga" text)))
    (should (string-match-p "Wednesday  29 April 2026" text))
    (should (string-match-p "↪ .*17:00[.]+ Yoga" text))))

(ert-deftest mediant-org-agenda-test-reschedule-time-range-replaces-visible-range ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: reschedule 2026-04-29 18:00-21:00\n"
                "<2026-04-21 Tue 17:00-18:00 +1w>")
               "2026-04-28"
               2)))
    (should-not (string-match-p "17:00-18:00[.]+ Yoga" text))
    (should (string-match-p "18:00-21:00 .*Yoga" text))))

(ert-deftest mediant-org-agenda-test-series-until-is-exclusive ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":SERIES-UNTIL: 2026-04-28\n")
               "2026-04-20"
               10)))
    (should (= 1 (mediant-org-agenda-test--count-matches "17:00[.]+ Yoga" text)))
    (should (string-match-p "Tuesday    21 April 2026" text))
    (should-not (string-match-p "Tuesday    28 April 2026\n.*Yoga" text))))

(ert-deftest mediant-org-agenda-test-moved-outside-visible-range-is-suppressed-with-base ()
  ;; Current behavior: a moved occurrence is generated only if its target day
  ;; exists in the visible agenda buffer.  The base occurrence is still
  ;; suppressed, so moving outside the current agenda range intentionally
  ;; removes it from this view; it will appear when the target date is visible.
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: reschedule 2026-05-03 18:00\n")
               "2026-04-28"
               2)))
    (should-not (string-match-p "17:00[.]+ Yoga" text))
    (should-not (string-match-p "18:00[.]+ Yoga" text))
    (should-not (string-match-p "Yoga" text))))

(ert-deftest mediant-org-agenda-test-non-recurring-entries-are-untouched ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "One-off"
                ":EXCEPTION-2026-04-28: cancelled\n:EXCEPTION-NOTE-2026-04-28: Hidden note\n"
                "<2026-04-28 Tue 17:00>")
               "2026-04-28"
               1)))
    (should (string-match-p "17:00[.]+ One-off" text))
    (should-not (string-match-p "Hidden note" text))))

(ert-deftest mediant-org-agenda-test-invalid-exception-values-are-ignored ()
  (let ((text (mediant-org-agenda-test--agenda-text
               (mediant-org-agenda-test--active-event
                "Yoga"
                ":EXCEPTION-2026-04-28: nonsense please\n")
               "2026-04-28"
               1)))
    (should (string-match-p "17:00[.]+ Yoga" text))
    (should-not (string-match-p "↪" text))))

(provide 'mediant-org-agenda-test)

;;; mediant-org-agenda-test.el ends here
