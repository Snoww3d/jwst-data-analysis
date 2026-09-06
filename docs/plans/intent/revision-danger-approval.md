# Intent: Revision-specific danger approval

The owner approved dependency waiting, clearer approval, and automatic repair/recheck handling in personal-os. JWST is an opted-in repository and needs the compatible approval gate before the app can approve its PRs.

Today an owner-applied danger-approved label can outlive the revision reviewed. The owner should be able to approve from personal-os or GitHub mobile with explicit evidence of the head/base and see when that evidence expires.

Success: a current owner receipt passes the human signal; stale, revoked, foreign or missing receipts fail. Spec requirements remain in force. No merges or application behavior changes are included.
