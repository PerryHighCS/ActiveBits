const presetPassages = [
    {
        label: "Abstraction Explanation",
        title: "Understanding Abstraction in Networking",
        value: "In computer networking, abstraction means hiding complicated details so that we can focus on the big picture. When you open a website, you don't have to think about how your message is broken into packets, routed across the country, and reassembled. It just works. Each layer of the network handles its own job, like putting an envelope in a mailbox or translating a sentence into another language. This makes it easier to build reliable systems, because everyone can work on their own layer without needing to understand the whole thing.",
        adjectives: ["clear", "simple", "reliable", "layered", "modular", "transparent", "efficient"],
        nouns: ["signal", "note", "path", "bridge", "bit", "message", "route", "node", "layer", "packet", "stack", "system", "frame"]
    },
    {
        label: "Fantasy",
        title: "The Spellbook of Cybershire",
        value: "In the kingdom of Cybershire, the scroll of TCP/IP weaves together a spellbook of messages. A humble peasant (your browser) casts a spell (an HTTP request), and through layers of arcane incantation, the message reaches the distant Oracle (a web server), who responds with enchanted glyphs (HTML). The villagers need not understand the spirits of Ethernet or the wind-routed DNS familiars-they simply trust the ancient runes of abstraction to carry the magic safely home.",
        adjectives: ["arcane", "enchanted", "ancient", "mystic", "magical", "woven", "layered", "hidden", "otherworldly"],
        nouns: ["scroll", "glyph", "rune", "familiar", "tome", "spellbook", "incantation", "oracle"]
    },
    {
        label: "Historical Fiction",
        title: "Signals Across the Alps",
        value: "In the days of semaphore towers and coded letters, abstraction was a matter of survival. A general didn't care how the message crossed the Alps, only that the signal reached the front lines intact. Today's networks follow the same creed: layer upon layer, each doing its job, concealing the complexity below, ensuring the command rides safely on.",
        adjectives: ["aged", "weathered", "sealed", "coded", "tactical", "encrypted", "layered", "hidden"],
        nouns: ["dispatch", "missive", "cipher", "courier", "banner", "signal", "command"]
    },
    {
        label: "Psychological Drama",
        title: "The Fragmented Mind",
        value: "He didn't need to understand the protocols. Not really. It was enough to know that somewhere, deep beneath the blinking interface, his message was fragmented, encoded, routed, and reassembled. Abstraction was comfort. It was distance. It was the lie he needed to believe: that the machine just worked.",
        adjectives: ["fragmented", "internal", "shadowed", "distanced", "echoing", "hidden"],
        nouns: ["mirror", "fragment", "echo", "mask", "shadow", "message"]
    },
    {
        label: "Science Fiction",
        title: "Encrypted Ambassadors of the Stars",
        value: "In the neon-lit datascapes of the future, abstraction is the secret language of interstellar communication. Starships don't beam raw binary at each other, they encapsulate intent in protocols, much like ambassadors speaking through encrypted translators. At every layer, from quantum pulse to hyperpacket, abstraction lets one ship's operating system speak with another's, without either crew knowing-or caring-about the other's wiring. Just as warp drives mask the terror of relativistic math, networking abstractions conceal complexity behind elegant layers.",
        adjectives: ["neon", "quantum", "synthetic", "stellar", "encrypted", "hyper", "interstellar", "elegant"],
        nouns: ["datascape", "protocol", "starship", "layer", "pulse", "core", "drone", "datastream", "signal"]
    },
    {
        label: "Spy Thriller",
        title: "The Abstraction Shield and the Hidden Path",
        value: "The agent inserts a flash drive into the terminal. Routine, efficient, untraceable. But beneath the calm surface of her data exfiltration lies a shadow war of abstractions. Her message, encoded in HTTP requests and DNS lookups, rides hidden on well-traveled paths, each layer shielding the next. She doesn't need to know how the bits traverse routers or which MAC address her packet wore, only that the abstraction held, and her secret made it to HQ.",
        adjectives: ["covert", "oblique", "stealthy", "encoded", "anonymous", "hidden"],
        nouns: ["file", "drop", "deadzone", "alias", "package", "message", "mark", "target"]
    },
    {
        label: "Western",
        title: "Messages on the Wire",
        value: "Out on the dusty range, messages didn't ride on horses no more-they rode the wires. And just like a rider swaps horses at every station, data passes through layers, each one takin' care of its own stretch. The rancher don't ask how the telegram gets from Tombstone to Tumbleweed, he just tips his hat when it arrives. That's abstraction for you: trust the trail, not the tack.",
        adjectives: ["dusty", "worn", "gritty", "lonesome", "rusty", "open", "vast"],
        nouns: ["telegram", "rider", "range", "wires", "station", "horse", "cattle", "dust", "trail", "saddle"]
    }
];

export default presetPassages;
