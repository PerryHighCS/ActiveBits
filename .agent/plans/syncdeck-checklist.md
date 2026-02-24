# SyncDeck Plan Checklist

Use this checklist to track implementation progress for SyncDeck. Update this file as tasks are completed.

## Future work
- [ ] Student position
    - [ ] Student panel shows behind/synced/ahead indicator
    - [ ] Instructor header indicates # Students connected / # Students behind

- [ ] Embedded activities
    - [ ] Presentations can start activity by slide events
    - [ ] Embedded activities have their own session that session links to parent session
        - maybe by id formatted ie CHILD:parentid:childid
        - with id and parentid as session ids
        - server does not cull children until parent is culled
        - student ids/names synced to parent session
    - [ ] Instructor should be able to download a report - activities will need to be able to generate html for report
    - [ ] Need some kind of picker for the activities that can give codes to presentation

- [ ] Chalkboard
    - [ ] See if current plugin is extendable with tool switching back and forth
    - [ ] Create new version? With color picker, tool swap, erase all
    - [ ] Transmit drawings to students
    - [ ] Keep on slide after progressing?
