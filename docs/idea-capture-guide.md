# Idea Capture Guide

A comprehensive guide for capturing feature ideas and random thoughts from any device.

## Quick Reference

| Method | Device | Complexity | Best For |
|--------|--------|------------|----------|
| **GitHub Web/Mobile** | Any | Simple | Quick notes from phone |
| **Quick Script** | Desktop | Very Simple | One-liner ideas |
| **Interactive Script** | Desktop | Simple | Detailed ideas with categories |
| **Claude Code** | Desktop | Simple | Ideas while coding |
| **Direct Edit** | Any | Simple | Maximum flexibility |

---

## Method 1: GitHub Mobile/Web (Easiest for Phone)

### Setup (One-time)
1. Install GitHub mobile app (iOS/Android) or use web browser
2. Navigate to repository: `Snoww3d/jwst-data-analysis`
3. Bookmark: `docs/feature-ideas.md`

### Add an Idea
1. Open `docs/feature-ideas.md` in GitHub app/web
2. Tap/click "Edit" (pencil icon)
3. Scroll to bottom
4. Copy the template or use quick format:
   ```markdown
   ### [Your Idea Name]
   **Date**: 2026-02-07
   **Category**: Scientific Features
   **Priority**: Medium

   **Description**:
   Your idea description...
   ```
5. Commit with message: `feat: Add idea - [idea name]`
6. Push to main (or create branch for review)

**Pro Tip**: Create a GitHub mobile shortcut to this file for instant access!

---

## Method 2: Quick Script (Desktop - One-Liner)

Perfect for capturing a quick thought while working:

```bash
# One-liner with argument
./scripts/quick-idea.sh "Add spectral line detection tool"

# Or pipe from echo
echo "Implement dark mode for UI" | ./scripts/quick-idea.sh

# Or with heredoc for multi-line
./scripts/quick-idea.sh << EOF
Add batch processing for multiple FITS files
- Support drag-and-drop
- Progress bar for batch operations
- Export results as ZIP
EOF
```

This appends to `docs/feature-ideas.md` with minimal metadata.

---

## Method 3: Interactive Script (Desktop - Detailed)

For more structured ideas with full metadata:

```bash
./scripts/add-idea.sh
```

This will prompt you for:
- Idea name
- Category (UI/UX, Scientific, Performance, etc.)
- Priority (Low/Medium/High)
- Description (multi-line)
- Use case (optional)
- Technical notes (optional)

---

## Method 4: Claude Code (Desktop)

When working with Claude Code, you can ask:

```
Add this to feature ideas: "Implement real-time collaborative FITS viewing"
```

Or create a custom `/add-idea` skill (advanced):

```
/add-idea Spectral Line Detection Tool
```

---

## Method 5: Direct File Edit (Any Device)

For maximum control, edit `docs/feature-ideas.md` directly:

**Desktop**:
```bash
# Open in your editor
code docs/feature-ideas.md
# or
vim docs/feature-ideas.md
```

**Mobile**:
- Use GitHub mobile app's file editor
- Use any mobile text editor with git sync:
  - **iOS**: Working Copy, Textastic
  - **Android**: MGit, Termux

---

## Idea Template

Use this template for consistency:

```markdown
### [Idea Name]
**Date**: YYYY-MM-DD
**Category**: [See categories in feature-ideas.md]
**Priority**: [Low/Medium/High]

**Description**:
Brief description of the idea...

**Use Case**:
Why is this useful? What problem does it solve?

**Technical Notes** (optional):
Any technical considerations or implementation thoughts...
```

---

## Categories

- 🎨 **UI/UX Improvements** - User interface and experience
- 🔬 **Scientific Features** - Astronomy/science-related features
- 🚀 **Performance Enhancements** - Speed and optimization
- 🔧 **Technical Improvements** - Architecture, refactoring, tech debt
- 📱 **Mobile/Responsive Features** - Mobile-specific features
- 🔒 **Security & Authentication** - Security-related ideas
- 📊 **Data Management** - Import, export, data handling
- 🎓 **Documentation & Tutorials** - Docs and educational content
- 💡 **Other Ideas** - Everything else

---

## Workflow

### Casual Ideas (No PR Required)
For quick thoughts and brainstorming:
1. Add idea to `docs/feature-ideas.md`
2. Commit directly to main: `git commit -m "feat: Add idea - [name]"`
3. Push: `git push`

### Formal Feature Proposals (PR Required)
For well-thought-out features ready for implementation:
1. Create feature branch: `git checkout -b feature/idea-[name]`
2. Add detailed idea with implementation plan
3. Create PR for team discussion
4. After approval, move to `docs/development-plan.md`

---

## Tips

### Mobile Shortcuts
- **iOS**: Add GitHub shortcut to home screen
  - Safari → Share → Add to Home Screen
- **Android**: Add bookmark to app drawer
  - Chrome → Menu → Add to Home screen

### Voice Input
On mobile, use voice-to-text for faster idea capture:
1. Tap text field in GitHub editor
2. Tap microphone icon on keyboard
3. Speak your idea
4. Review and commit

### Email-to-Git (Advanced)
Set up GitHub Actions to monitor a specific email address and auto-commit ideas:
- Send email to `ideas@yourdomain.com`
- Action parses email and appends to feature-ideas.md
- Useful for capturing ideas anytime, anywhere

### Offline Capture
If offline, use:
- Phone's Notes app (sync later via manual copy-paste)
- Voice recorder (transcribe later)
- Local git clone with manual sync when back online

---

## Integration with Development

Ideas in `docs/feature-ideas.md` can be:
1. **Discussed** - Team reviews and comments
2. **Prioritized** - Marked Low/Medium/High
3. **Refined** - Expanded with technical details
4. **Promoted** - Moved to `docs/development-plan.md` for implementation
5. **Tracked** - Converted to GitHub Issues or tasks

---

## Example Workflow: Phone to Production

1. **Capture** (Phone, 30 seconds)
   - Open GitHub app
   - Edit `docs/feature-ideas.md`
   - Add: "Add spectral line detection"
   - Commit to main

2. **Review** (Desktop, next session)
   - Claude Code sees the new idea
   - You or AI expands it with details

3. **Plan** (Desktop)
   - Move to `docs/development-plan.md`
   - Add to appropriate phase
   - Break down into tasks

4. **Implement** (Desktop)
   - Use `/create-feature` workflow
   - Build the feature
   - Create PR

5. **Ship** (Desktop)
   - Merge PR
   - Update docs
   - Mark complete in development plan

---

## Troubleshooting

**Q: Can't edit files on GitHub mobile?**
- A: Ensure you have push access to the repository
- A: Try GitHub web interface instead of app
- A: Fork the repo and submit via PR

**Q: Script not executable?**
- A: Run `chmod +x scripts/add-idea.sh scripts/quick-idea.sh`

**Q: Want to keep ideas private?**
- A: Create a private `docs/private-ideas.md` (add to .gitignore)
- A: Use a separate private repository for sensitive ideas

**Q: How to organize many ideas?**
- A: Ideas file gets long over time - periodically:
  - Archive implemented ideas to `docs/implemented-features.md`
  - Move stale ideas to `docs/idea-archive.md`
  - Consolidate similar ideas

---

## Advanced: Custom Claude Code Skill

To create a `/add-idea` skill in Claude Code:

1. Create skill file: `~/.claude/commands/add-idea.md`
2. Add skill definition (see `.agent/workflows/` for examples)
3. Skill can prompt for details and commit automatically

This would make idea capture seamless during coding sessions.

---

## Questions?

If you have questions about the idea capture system:
- Check existing ideas for examples
- Review this guide
- Ask in team chat or GitHub Discussions

Happy ideating! 💡
