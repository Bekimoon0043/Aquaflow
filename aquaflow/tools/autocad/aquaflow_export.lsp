;;; aquaflow_export.lsp -- AquaFlow AF-CAD-019
;;;
;;; AQFEXPORT: export every model-space block reference of the current drawing to
;;; an AquaFlow JSON file -- the zero-licence DWG path. AutoCAD itself reads the
;;; DWG; AquaFlow ingests the JSON (backend services/cad_lisp_import.py,
;;; import_aqf_json) into the same import shape as a DXF.
;;;
;;; Per INSERT it writes: handle, block name, effective name (dynamic blocks
;;; resolved via vla-get-EffectiveName), layer, insertion point in WCS, rotation
;;; (degrees), scale, extrusion, attributes (TAG -> value) and the raw AQUAFLOW
;;; XDATA strings. The header carries $INSUNITS, DWGNAME and ACADVER.
;;;
;;; Output is pure ASCII JSON: every character outside 0x20..0x7E is written as a
;;; \uXXXX escape, so the file is identical whatever the system code page.
;;;
;;; Usage:  APPLOAD this file, then type AQFEXPORT.
;;;         Scripts / batch:  (aqf:export "C:/path/out.aqf.json")  -> count or nil

(vl-load-com)

(defun aqf:hex4 (n / h d)
  (setq h "")
  (repeat 4
    (setq d (rem n 16)
          h (strcat (substr "0123456789abcdef" (1+ d) 1) h)
          n (/ n 16)))
  h)

(defun aqf:esc-code (c / hi lo)
  (cond
    ((= c 34) "\\\"")
    ((= c 92) "\\\\")
    ((and (>= c 32) (<= c 126)) (chr c))
    ((> c 65535)                                   ; astral plane -> surrogate pair
     (setq c (- c 65536)
           hi (+ 55296 (/ c 1024))
           lo (+ 56320 (rem c 1024)))
     (strcat "\\u" (aqf:hex4 hi) "\\u" (aqf:hex4 lo)))
    (T (strcat "\\u" (aqf:hex4 c)))))

(defun aqf:str (s)
  (if (null s) (setq s ""))
  (strcat "\"" (apply 'strcat (mapcar 'aqf:esc-code (vl-string->list s))) "\""))

(defun aqf:num (x) (rtos (float x) 2 9))          ; DIMZIN is forced to 0 meanwhile

(defun aqf:vec (p)
  (strcat "[" (aqf:num (car p)) "," (aqf:num (cadr p)) ","
          (aqf:num (if (caddr p) (caddr p) 0.0)) "]"))

(defun aqf:join (items sep / out)
  (setq out "")
  (foreach it items
    (setq out (if (= out "") it (strcat out sep it))))
  out)

(defun aqf:effective-name (ename fallback / obj r)
  (setq r (vl-catch-all-apply
            '(lambda ()
               (setq obj (vlax-ename->vla-object ename))
               (vla-get-EffectiveName obj))))
  (if (or (null r) (vl-catch-all-error-p r)) fallback r))

(defun aqf:attribs (ename ed / e aed out)
  ;; Walk the ATTRIB entities that follow the INSERT (works without COM too).
  (if (= 1 (cdr (assoc 66 ed)))
    (progn
      (setq e (entnext ename))
      (while (and e (= "ATTRIB" (cdr (assoc 0 (setq aed (entget e))))))
        (setq out (cons (strcat (aqf:str (cdr (assoc 2 aed))) ":"
                                (aqf:str (cdr (assoc 1 aed))))
                        out))
        (setq e (entnext e)))))
  (strcat "{" (aqf:join (reverse out) ",") "}"))

(defun aqf:xdata (ed / xd app out)
  (setq xd (cdr (assoc -3 ed)))
  (if (setq app (assoc "AQUAFLOW" xd))
    (foreach pr (cdr app)
      (if (= 1000 (car pr)) (setq out (cons (aqf:str (cdr pr)) out)))))
  (strcat "[" (aqf:join (reverse out) ",") "]"))

(defun aqf:insert-json (ename / ed name rot ext)
  (setq ed   (entget ename '("AQUAFLOW"))
        name (cdr (assoc 2 ed))
        rot  (cdr (assoc 50 ed))
        ext  (cdr (assoc 210 ed)))
  (strcat
    "{\"handle\":" (aqf:str (cdr (assoc 5 ed)))
    ",\"name\":" (aqf:str name)
    ",\"effective_name\":" (aqf:str (aqf:effective-name ename name))
    ",\"layer\":" (aqf:str (cdr (assoc 8 ed)))
    ",\"insertion\":" (aqf:vec (trans (cdr (assoc 10 ed)) ename 0))   ; OCS -> WCS
    ",\"rotation_deg\":" (aqf:num (* 180.0 (/ (if rot rot 0.0) pi)))
    ",\"scale\":" (aqf:vec (list (cond ((cdr (assoc 41 ed))) (1.0))
                                 (cond ((cdr (assoc 42 ed))) (1.0))
                                 (cond ((cdr (assoc 43 ed))) (1.0))))
    ",\"extrusion\":" (aqf:vec (if ext ext '(0.0 0.0 1.0)))
    ",\"attribs\":" (aqf:attribs ename ed)
    ",\"xdata_aquaflow\":" (aqf:xdata ed)
    "}"))

(defun aqf:export (path / ss f i n old-dimzin)
  (setq old-dimzin (getvar "DIMZIN"))
  (setvar "DIMZIN" 0)
  (setq ss (ssget "_X" '((0 . "INSERT") (410 . "Model")))
        n  (if ss (sslength ss) 0))
  (if (setq f (open path "w"))
    (progn
      (write-line "{" f)
      (write-line "\"format\":\"AQFEXPORT\",\"version\":1," f)
      (write-line (strcat "\"drawing\":" (aqf:str (getvar "DWGNAME")) ",") f)
      (write-line (strcat "\"acadver\":" (aqf:str (getvar "ACADVER")) ",") f)
      (write-line (strcat "\"insunits\":" (itoa (getvar "INSUNITS")) ",") f)
      (write-line "\"inserts\":[" f)
      (setq i 0)
      (while (< i n)
        (write-line (strcat (aqf:insert-json (ssname ss i)) (if (< i (1- n)) "," "")) f)
        (setq i (1+ i)))
      (write-line "]}" f)
      (close f)))
  (setvar "DIMZIN" old-dimzin)
  (if f n nil))

(defun c:AQFEXPORT (/ *error* old-dimzin default path n)
  (setq old-dimzin (getvar "DIMZIN"))
  (defun *error* (msg)
    (setvar "DIMZIN" old-dimzin)
    (if (not (member msg '("Function cancelled" "quit / exit abort")))
      (princ (strcat "\nAQFEXPORT error: " msg)))
    (princ))
  (setq default (strcat (getvar "DWGPREFIX") (vl-filename-base (getvar "DWGNAME")) ".aqf.json")
        path    (getfiled "Export AquaFlow JSON" default "json" 1))
  (if path
    (if (setq n (aqf:export path))
      (princ (strcat "\nAQFEXPORT: " (itoa n) " block reference(s) written to " path))
      (princ (strcat "\nAQFEXPORT: cannot write " path))))
  (princ))

(princ "\nAquaFlow export loaded. Type AQFEXPORT to write model-space blocks to JSON.")
(princ)
