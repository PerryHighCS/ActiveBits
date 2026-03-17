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
    - [ ] Document embedded-activity protocol before implementation
        - define transport model and whether embedded activities use separate sockets or a multiplexed socket
        - if multiplexing is allowed, define the message envelope for activity/session routing explicitly
        - if multiplexing is not allowed, document that separate websocket connections per activity/session are required
    - [ ] Define embedded-activity activation/claim flow for already-connected parent-session users
        - evaluate persistent-link-like flow vs session-connected flow
        - candidate: instructor requests child session over parent websocket, then joins child session
        - parent session sends per-user claim tokens so users claim mapped seats in child session
    - [ ] Define multi-instructor arbitration for embedded-activity activation
        - prevent duplicate child-session creation when multiple instructors are connected
        - define lock/leader/ownership rules for create/retry/cancel flows
    - [ ] Instructor should be able to download a report - activities will need to be able to generate html for report
    - [ ] Need some kind of picker for the activities that can give codes to presentation

- [ ] Chalkboard
    - [ ] Combine chalkboard button and pen button into one unified control
    - [ ] Add a blank-screen tool that is available when chalkboard is active
    - [ ] See if current plugin is extendable with tool switching back and forth
    - [ ] Create new version? With color picker, tool swap, erase all
    - [ ] Transmit drawings to students
    - [ ] Keep on slide after progressing?
