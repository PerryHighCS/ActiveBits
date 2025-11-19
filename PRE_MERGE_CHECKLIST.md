# Pre-Merge Checklist

Before merging the `refactor/activity-structure` branch into `main`, verify the following:

## Testing

- [ ] Development server starts without errors (`npm run dev`)
- [ ] Can access the management dashboard at `/manage`
- [ ] Can create a raffle session
- [ ] Students can join raffle sessions and receive tickets
- [ ] Can create a www-sim session
- [ ] Students can join www-sim sessions
- [ ] All existing functionality works as expected
- [ ] No console errors in browser developer tools
- [ ] No server errors in terminal

## Code Quality

- [ ] All files have correct imports
- [ ] No unused imports or variables
- [ ] Code follows existing style patterns
- [ ] Activity registry properly exports all activities
- [ ] Routes are generated correctly from activity config

## Documentation

- [ ] README.md is up to date
- [ ] ARCHITECTURE.md accurately describes structure
- [ ] ADDING_ACTIVITIES.md provides clear examples
- [ ] All documentation links work correctly

## Deployment

- [ ] Production build completes successfully (`npm run deploy`)
- [ ] No build warnings or errors
- [ ] Deployment scripts still work
- [ ] Environment variables are compatible

## Git

- [ ] All changes are committed
- [ ] Commit messages are clear and descriptive
- [ ] No merge conflicts with main
- [ ] Branch is up to date with main

## Performance

- [ ] Page load times are acceptable
- [ ] No memory leaks observed
- [ ] Session cleanup works correctly
- [ ] WebSocket connections function properly

## Commands to Run

```bash
# Run these commands to verify everything works:

# 1. Pull latest from main and rebase
git checkout main
git pull
git checkout refactor/activity-structure
git rebase main

# 2. Install dependencies
npm run install-all

# 3. Test development mode
npm run dev
# Then manually test both activities

# 4. Test production build
npm run deploy
npm run start
# Then manually test both activities

# 5. Check for errors
npm run start --prefix server  # Watch for server errors
npm run build --prefix client  # Check for build warnings

# 6. If everything works, merge!
git checkout main
git merge refactor/activity-structure
git push
```

## Rollback Plan

If issues are discovered after merging:

```bash
# Find the commit hash before the merge
git log --oneline

# Revert to that commit
git reset --hard <commit-hash>
git push --force
```

Or create a revert commit:

```bash
git revert -m 1 <merge-commit-hash>
git push
```

## Post-Merge Tasks

After successfully merging:

- [ ] Delete the feature branch locally: `git branch -d refactor/activity-structure`
- [ ] Delete the feature branch remotely: `git push origin --delete refactor/activity-structure`
- [ ] Update any open pull requests or issues
- [ ] Notify team members of the new structure
- [ ] Update any CI/CD pipelines if needed
- [ ] Monitor production for any issues

## Notes

- The refactoring maintains 100% backward compatibility
- User experience is unchanged
- API endpoints remain the same
- No database migrations needed
- Session storage format is unchanged
