# Crew import: one step for the IMO FAL crew list — Design

Date: 2026-11-15. Status: approved by the user in chat; a short design, because this is a small change.

## Why

The user picked their crew list (an IMO FAL crew list kept in Excel), and the import showed only settings: the header
row, every column, and the date format. They could not tell what to choose. They want to pick the file and see the crew.

Two things caused it:
- **The headings are numbered.** "8. Family name, given names" and "9. Rank or rating" normalise to `8familyname…`, so
  no heading is recognised and the header row is never found.
- **Paired columns.** FAL headings cover two columns, and the second column has no heading:
  - "10. Nationality and Sex": nationality, then sex;
  - "11. Date and place of birth";
  - "12. Passport No. & Expiry date";
  - "13. Seaman's Book No. & Expiry date";
  - "14. Date & Place of Join".

The screen also always opened with the settings, even when everything had been worked out.

A third problem: names in capitals written surname first ("SURNAME GIVEN NAMES") were stored with the whole name as
the surname.

## Design

1. **Numbered headings.** A leading `N.`, `N)`, `N:` or `N -` (one or two digits) is removed before a heading is
   matched.
   - So the saved-mapping key of such a heading changes. Columns mapped by hand under the old keys are lost once, but
     the guess now covers numbered headings, so the file is still read.
2. **Paired headings** (exact normalised texts):

   | Heading | First column | Next column |
   |---|---|---|
   | `nationalityandsex` | nationality | not used |
   | `dateandplaceofbirth`, `dateplaceofbirth` | date of birth | place of birth |
   | `passportnoexpirydate`, `passportnoandexpirydate` | passport no. | passport expiry |
   | `seamansbooknoexpirydate`, `seamansbooknoandexpirydate` | seaman's book no. | seaman's book expiry |
   | `dateplaceofjoin`, `dateandplaceofjoin`, `dateplaceofjoining`, `dateandplaceofjoining` | sign-on date | sign-on port |

   - The next column takes the second field only when its heading is blank and the field has no column yet.
   - When a paired heading is ignored by the user, its blank next column is ignored with it, since it has no heading text
     to be saved by.
   - A paired heading counts as one recognised heading when the header row is found.
3. **More heading words** for home-made lists:
   - `crewname`, `surnameandname`, `surnamename` (full name);
   - `duty`, `post` (rank). These match exactly only, so "Post code" and "Duty free" don't become rank;
   - `nat` (nationality);
   - `passno` (passport no.);
   - `dateofjoin` (sign-on date);
   - `placeofjoin`, `portofjoin` (sign-on port).
4. **Surname-first names.**
   - When the full-name column's heading puts the family name first (`familynamegivennames`, `surnameandgivennames`,
     `surnameandname`, `surnamename`), a name with no comma splits after its first word.
   - If the name starts with a particle (DE, DEL, DELA, DELOS, DELAS, DA, DOS, DAS, DI, DU, LA, LE, VAN, VON, MC,
     SAN, SANTA; or DE LA, DE LOS, DE LAS, VAN DER, VAN DEN, VON DER), the particle and the word after it are the
     surname.
   - A particle is used only when at least one given name is left over. LE, LA and DU are not particles, so
     Vietnamese and Chinese names such as LE VAN THANH keep LE as the surname.
   - Commas keep their meaning, and other headings keep today's rule.
5. **One-step screen.**
   - When the mapping has a name column and the preview has at least one person, the screen shows "Found N crew members.
     Check the list and tap Import." The Sheet, Header row, Columns, Date format and default sign-on fields are folded
     inside a closed **Adjust columns** section.
   - Otherwise the section is open, with a plain line: "Couldn't find a column with names. Choose which column holds the
     names under Adjust columns." The same line is used for an empty preview.
   - The preview and the Import button are unchanged.

## Not changed

- How crew are stored or merged.
- The fix form.
- The saved mapping format.
- Nothing about the user's crew is committed: tests use made-up names in a FAL-shaped sheet.

## Approaches

- **Chosen:** teach the matcher the FAL layout and fold the settings. This is small, and every other layout keeps working.
- **Rejected:** a dedicated "FAL import" button. It's one more choice for the user, and home-made lists would still
  have the problem.
- **Rejected:** guessing columns from their contents. It is more work, and its mistakes are silent. It is left for
  later if headings still fail.
