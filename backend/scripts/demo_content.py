"""Content for the reviewer demo account (scripts/seed_demo_account.py). Original study material
written for the demo: no real student data. Three courses, two study sets each, and one recorded
lecture for BIO 101 and HIST 210."""

COURSES = {
    "bio": "BIO 101 Biology",
    "hist": "HIST 210 Modern World History",
    "chem": "CHEM 120 General Chemistry",
}

# Each set: an outline (the Outline page's text format), Q&A pairs (the guide and its flashcards)
# and multiple-choice quiz questions (Quiz and Learn).
STUDY_SETS = [
    {
        "slug": "bio-cell-structure",
        "course": "bio",
        "title": "Cell Structure and Organelles",
        "outline": [
            ("> Cells are the basic units of life; organelles divide the work of a eukaryotic cell.", []),
            ("## Two kinds of cells", [
                "**Prokaryotic cells** (bacteria and archaea) have no nucleus and no membrane-bound organelles",
                "**Eukaryotic cells** (plants, animals, fungi, protists) keep their DNA in a nucleus and have membrane-bound organelles",
            ]),
            ("## The nucleus and protein making", [
                "The **nucleus** holds the cell's DNA inside a double membrane called the nuclear envelope",
                "The **nucleolus**, inside the nucleus, makes ribosomal RNA and assembles ribosome subunits",
                "**Ribosomes** build proteins; they float free in the cytoplasm or sit on the rough ER",
                "The **rough ER** is studded with ribosomes and makes proteins for membranes and for export",
                "The **smooth ER** makes lipids and breaks down some toxins",
                "The **Golgi apparatus** modifies, sorts and packages proteins and sends them on in vesicles",
            ]),
            ("## Energy and clean-up", [
                "**Mitochondria** carry out aerobic respiration and make most of the cell's ATP",
                "Mitochondria have their own DNA and a double membrane",
                "**Lysosomes** contain digestive enzymes that break down worn-out parts and waste",
            ]),
            ("## Plant cells add", [
                "A **cell wall** made of cellulose gives support",
                "**Chloroplasts** carry out photosynthesis",
                "A large **central vacuole** stores water and keeps the cell firm",
            ]),
            ("## Key points", [
                "Only eukaryotic cells have a nucleus and membrane-bound organelles",
                "Proteins move from ribosomes on the rough ER to the Golgi apparatus for packaging",
                "Mitochondria make most ATP; chloroplasts capture light energy in plants",
            ]),
        ],
        "pairs": [
            ("What do mitochondria do?", "They carry out aerobic respiration and make most of the cell's ATP."),
            ("What is the job of ribosomes?", "They build proteins."),
            ("How is the rough ER different from the smooth ER?", "The rough ER has ribosomes and makes proteins; the smooth ER makes lipids and breaks down some toxins."),
            ("What does the Golgi apparatus do?", "It modifies, sorts and packages proteins and ships them in vesicles."),
            ("What do lysosomes contain?", "Digestive enzymes that break down waste and worn-out cell parts."),
            ("Name three structures plant cells have that animal cells lack.", "A cellulose cell wall, chloroplasts and a large central vacuole."),
            ("What do prokaryotic cells lack?", "A nucleus and membrane-bound organelles."),
            ("What does the nucleolus make?", "Ribosomal RNA, and it assembles ribosome subunits."),
        ],
        "quiz": [
            ("Which organelle makes most of a cell's ATP?", ["Golgi apparatus", "Mitochondrion", "Lysosome", "Ribosome"], 1),
            ("Where are proteins for export first made?", ["Smooth ER", "Rough ER", "Central vacuole", "Nucleolus"], 1),
            ("Which structure is found in plant cells but not animal cells?", ["Ribosome", "Mitochondrion", "Cell wall", "Golgi apparatus"], 2),
            ("Which kind of cell has no nucleus?", ["Prokaryotic", "Plant", "Animal", "Fungal"], 0),
        ],
    },
    {
        "slug": "bio-cellular-respiration",
        "course": "bio",
        "title": "Cellular Respiration",
        "outline": [
            ("> Cells release the energy stored in glucose and capture it as ATP, in three stages.", []),
            ("## The overall reaction", [
                "Glucose + 6 O₂ → 6 CO₂ + 6 H₂O + energy, captured as **ATP**",
                "About 30 to 32 ATP are made per glucose when oxygen is present",
            ]),
            ("## Stage 1: Glycolysis", [
                "Happens in the **cytoplasm** and does **not** need oxygen",
                "Splits one glucose into **two pyruvate**",
                "Net gain: 2 ATP and 2 NADH",
            ]),
            ("## Stage 2: The Krebs cycle", [
                "Pyruvate is oxidized and enters the **Krebs (citric acid) cycle** in the mitochondrial matrix",
                "Releases CO₂ and loads electron carriers NADH and FADH₂",
                "Makes 2 ATP per glucose",
            ]),
            ("## Stage 3: The electron transport chain", [
                "Sits in the **inner mitochondrial membrane**",
                "NADH and FADH₂ hand over electrons; their energy pumps protons across the membrane",
                "**Oxygen is the final electron acceptor** and becomes water",
                "Protons flow back through **ATP synthase**, which makes most of the ATP (**chemiosmosis**)",
            ]),
            ("## Without oxygen", [
                "**Fermentation** regenerates NAD⁺ so glycolysis can keep going",
                "Muscle cells make lactic acid; yeast make ethanol and CO₂",
            ]),
            ("## Key points", [
                "Glycolysis (cytoplasm) → Krebs cycle (matrix) → electron transport chain (inner membrane)",
                "Oxygen's role is to accept electrons at the end of the chain",
                "Most ATP comes from the electron transport chain and ATP synthase",
            ]),
        ],
        "pairs": [
            ("Where does glycolysis happen?", "In the cytoplasm."),
            ("Does glycolysis need oxygen?", "No; it works with or without oxygen."),
            ("What does glycolysis produce from one glucose?", "Two pyruvate, with a net gain of 2 ATP and 2 NADH."),
            ("Where does the Krebs cycle take place?", "In the mitochondrial matrix."),
            ("What is the final electron acceptor in the electron transport chain?", "Oxygen, which becomes water."),
            ("Which stage makes most of the ATP?", "The electron transport chain, through ATP synthase (chemiosmosis)."),
            ("What does fermentation accomplish?", "It regenerates NAD⁺ so glycolysis can continue without oxygen."),
            ("What do muscle cells make during fermentation?", "Lactic acid."),
        ],
        "quiz": [
            ("Where does the electron transport chain take place?", ["Cytoplasm", "Inner mitochondrial membrane", "Nucleus", "Outer cell membrane"], 1),
            ("What is the net ATP gain from glycolysis?", ["2 ATP", "4 ATP", "32 ATP", "0 ATP"], 0),
            ("What role does oxygen play in cellular respiration?", ["It splits glucose", "It is the final electron acceptor", "It makes pyruvate", "It carries protons"], 1),
            ("Which enzyme uses the proton flow to make ATP?", ["ATP synthase", "Amylase", "Helicase", "Lipase"], 0),
        ],
    },
    {
        "slug": "hist-causes-wwi",
        "course": "hist",
        "title": "Causes of World War I",
        "outline": [
            ("> Long-term pressures (militarism, alliances, imperialism and nationalism) turned a regional crisis into a world war in 1914.", []),
            ("## Long-term causes (MAIN)", [
                "**Militarism**: European powers built up armies, and Britain and Germany raced to build battleships (dreadnoughts)",
                "**Alliances**: the **Triple Entente** (France, Russia, Britain) faced the **Triple Alliance** (Germany, Austria-Hungary, Italy)",
                "**Imperialism**: rivalry over colonies, such as the Moroccan crises of 1905 and 1911",
                "**Nationalism**: Serbian and Pan-Slav nationalism clashed with Austria-Hungary in the Balkans",
                "Austria-Hungary annexed **Bosnia** in 1908, angering Serbia",
            ]),
            ("## The spark", [
                "On **28 June 1914**, **Archduke Franz Ferdinand**, heir to Austria-Hungary, was assassinated in **Sarajevo**",
                "The assassin, **Gavrilo Princip**, was a Bosnian Serb linked to the Black Hand",
            ]),
            ("## The July Crisis", [
                "Germany promised Austria-Hungary unconditional support (the **blank cheque**) in early July",
                "Austria-Hungary sent Serbia an ultimatum on 23 July and declared war on 28 July",
                "Russia mobilized to support Serbia; Germany declared war on Russia on 1 August and on France on 3 August",
                "Germany invaded **Belgium** to reach France (the Schlieffen Plan)",
                "Britain declared war on Germany on **4 August 1914**, citing Belgian neutrality",
            ]),
            ("## Key points", [
                "MAIN: militarism, alliances, imperialism, nationalism",
                "The assassination in Sarajevo was the spark, not the only cause",
                "Alliances and mobilization plans spread a Balkan war across Europe within weeks",
            ]),
        ],
        "pairs": [
            ("What does the acronym MAIN stand for?", "Militarism, alliances, imperialism and nationalism."),
            ("Who was in the Triple Entente?", "France, Russia and Britain."),
            ("Who was in the Triple Alliance?", "Germany, Austria-Hungary and Italy."),
            ("Who was assassinated in Sarajevo on 28 June 1914?", "Archduke Franz Ferdinand, heir to the throne of Austria-Hungary."),
            ("What was the blank cheque?", "Germany's promise of unconditional support to Austria-Hungary in July 1914."),
            ("Why did Britain declare war on Germany?", "Germany invaded neutral Belgium on its way to France."),
            ("What was the Schlieffen Plan?", "Germany's plan to defeat France quickly by going through Belgium before turning on Russia."),
            ("Which territory did Austria-Hungary annex in 1908?", "Bosnia."),
        ],
        "quiz": [
            ("Where was Franz Ferdinand assassinated?", ["Vienna", "Belgrade", "Sarajevo", "Berlin"], 2),
            ("Which country was NOT in the Triple Entente?", ["France", "Germany", "Russia", "Britain"], 1),
            ("What reason did Britain give for entering the war?", ["The sinking of the Lusitania", "Germany's invasion of Belgium", "The Zimmermann telegram", "The annexation of Bosnia"], 1),
            ("When did Britain declare war on Germany?", ["28 June 1914", "28 July 1914", "4 August 1914", "11 November 1918"], 2),
        ],
    },
    {
        "slug": "hist-versailles",
        "course": "hist",
        "title": "The Treaty of Versailles",
        "outline": [
            ("> The 1919 peace treaty with Germany redrew borders, limited Germany's military and set up reparations and the League of Nations.", []),
            ("## The peace conference", [
                "Signed on **28 June 1919** in the Hall of Mirrors at the Palace of Versailles",
                "The leading negotiators were **Woodrow Wilson** (US), **Georges Clemenceau** (France), **David Lloyd George** (Britain) and **Vittorio Orlando** (Italy)",
                "Germany was not allowed to negotiate the terms",
            ]),
            ("## Terms", [
                "**Article 231**, the war guilt clause, held Germany responsible for the war's loss and damage",
                "**Reparations** were set in 1921 at 132 billion gold marks",
                "**Alsace-Lorraine** returned to France",
                "The German army was capped at **100,000** soldiers, with no air force",
                "The **Rhineland** was demilitarized",
                "Germany's colonies became League of Nations mandates",
            ]),
            ("## The League of Nations", [
                "The treaty created the **League of Nations** to settle disputes peacefully",
                "The US Senate did not ratify the treaty, and the US never joined the League",
            ]),
            ("## Key points", [
                "The war guilt clause and reparations caused lasting resentment in Germany",
                "The treaty limited Germany's army to 100,000 and demilitarized the Rhineland",
                "The League of Nations began without the United States",
            ]),
        ],
        "pairs": [
            ("When was the Treaty of Versailles signed?", "On 28 June 1919."),
            ("What was Article 231?", "The war guilt clause, which held Germany responsible for the war's loss and damage."),
            ("How large could Germany's army be under the treaty?", "100,000 soldiers, with no air force."),
            ("Which territory went back to France?", "Alsace-Lorraine."),
            ("What happened to the Rhineland?", "It was demilitarized."),
            ("Why did the US not join the League of Nations?", "The US Senate did not ratify the treaty."),
            ("Who represented France at the peace conference?", "Georges Clemenceau."),
        ],
        "quiz": [
            ("Which clause blamed Germany for the war?", ["Article 10", "Article 231", "The Fourteen Points", "The Monroe Doctrine"], 1),
            ("What was the cap on the German army?", ["10,000", "100,000", "500,000", "1,000,000"], 1),
            ("Which country never joined the League of Nations?", ["France", "Britain", "Italy", "The United States"], 3),
            ("Who led the British delegation?", ["Winston Churchill", "David Lloyd George", "Neville Chamberlain", "Herbert Asquith"], 1),
        ],
    },
    {
        "slug": "chem-periodic-trends",
        "course": "chem",
        "title": "Atomic Structure and Periodic Trends",
        "outline": [
            ("> An atom's protons, neutrons and electrons explain its identity, and the periodic table's layout predicts its properties.", []),
            ("## Inside the atom", [
                "**Protons** (positive) and **neutrons** (no charge) sit in the nucleus; **electrons** (negative) occupy orbitals around it",
                "The **atomic number** is the number of protons and identifies the element",
                "The **mass number** is protons plus neutrons",
                "**Isotopes** have the same number of protons but different numbers of neutrons",
            ]),
            ("## Trends across a period (left to right)", [
                "**Atomic radius** decreases, because effective nuclear charge increases",
                "**Ionization energy** increases",
                "**Electronegativity** increases",
            ]),
            ("## Trends down a group (top to bottom)", [
                "Atomic radius increases, because electrons fill shells farther from the nucleus",
                "Ionization energy and electronegativity decrease",
            ]),
            ("## Groups to know", [
                "**Alkali metals** (group 1) have one valence electron and react strongly",
                "**Halogens** (group 17) have seven valence electrons",
                "**Noble gases** (group 18) have full valence shells and rarely react",
                "**Fluorine** is the most electronegative element",
            ]),
            ("## Key points", [
                "Atomic number = protons; mass number = protons + neutrons",
                "Radius shrinks across a period and grows down a group",
                "Ionization energy and electronegativity rise across a period and fall down a group",
            ]),
        ],
        "pairs": [
            ("What does the atomic number tell you?", "The number of protons, which identifies the element."),
            ("How do you find the mass number?", "Add the protons and the neutrons."),
            ("What are isotopes?", "Atoms of the same element with different numbers of neutrons."),
            ("How does atomic radius change across a period?", "It decreases, because effective nuclear charge increases."),
            ("How does ionization energy change down a group?", "It decreases."),
            ("Which element is the most electronegative?", "Fluorine."),
            ("How many valence electrons do alkali metals have?", "One."),
            ("Why do noble gases rarely react?", "Their valence shells are full."),
        ],
        "quiz": [
            ("An atom with 6 protons and 8 neutrons has what mass number?", ["6", "8", "14", "2"], 2),
            ("Which trend increases from left to right across a period?", ["Atomic radius", "Electronegativity", "Number of shells", "Metallic character"], 1),
            ("Which group holds the halogens?", ["Group 1", "Group 2", "Group 17", "Group 18"], 2),
            ("Isotopes of an element differ in their number of what?", ["Protons", "Electrons", "Neutrons", "Valence shells"], 2),
        ],
    },
    {
        "slug": "chem-stoichiometry",
        "course": "chem",
        "title": "Stoichiometry and the Mole",
        "outline": [
            ("> Stoichiometry uses balanced equations and the mole to predict how much reacts and how much forms.", []),
            ("## The mole", [
                "One **mole** is 6.022 × 10²³ particles (**Avogadro's number**)",
                "**Molar mass** is the mass of one mole in grams; water is about 18.02 g/mol",
                "Moles = mass ÷ molar mass",
            ]),
            ("## Balanced equations", [
                "Balancing keeps the same number of each atom on both sides (**conservation of mass**)",
                "Coefficients give the **mole ratio** between substances",
                "In 2 H₂ + O₂ → 2 H₂O, two moles of hydrogen react with one mole of oxygen",
            ]),
            ("## Limiting reactant and yield", [
                "The **limiting reactant** runs out first and sets how much product forms",
                "The other reactant is left over (the **excess reactant**)",
                "**Theoretical yield** is the amount the equation predicts",
                "**Percent yield** = actual yield ÷ theoretical yield × 100",
            ]),
            ("## Key points", [
                "Convert grams to moles before using mole ratios",
                "The limiting reactant decides the theoretical yield",
                "Percent yield compares what you got with what was possible",
            ]),
        ],
        "pairs": [
            ("How many particles are in one mole?", "6.022 × 10²³ (Avogadro's number)."),
            ("How do you convert grams to moles?", "Divide the mass by the molar mass."),
            ("What is the molar mass of water?", "About 18.02 g/mol."),
            ("Why must chemical equations be balanced?", "Mass is conserved, so each atom must appear in equal numbers on both sides."),
            ("What is a limiting reactant?", "The reactant that runs out first and limits how much product forms."),
            ("How do you calculate percent yield?", "Actual yield divided by theoretical yield, times 100."),
            ("In 2 H₂ + O₂ → 2 H₂O, how many moles of O₂ react with 4 moles of H₂?", "2 moles."),
        ],
        "quiz": [
            ("What is Avogadro's number?", ["6.022 × 10²³", "3.00 × 10⁸", "1.602 × 10⁻¹⁹", "9.81"], 0),
            ("A reaction predicts 20 g of product and gives 15 g. What is the percent yield?", ["15%", "75%", "133%", "25%"], 1),
            ("Which reactant decides how much product forms?", ["The excess reactant", "The limiting reactant", "The catalyst", "The solvent"], 1),
            ("How many moles of water form from 4 moles of H₂ with enough O₂?", ["2", "4", "8", "1"], 1),
        ],
    },
]

# Two recorded lectures. Segment times are milliseconds from the start; every "Watch for" quote and
# to-do quote is the speaker's own words in the transcript.
LECTURES = [
    {
        "slug": "bio-lecture-6",
        "course": "bio",
        "title": "Lecture 6: Cellular respiration",
        "days_ago": 2,
        "duration_ms": 50 * 60 * 1000,
        "segments": [
            (0, "Good morning. Today we're following one glucose molecule all the way to ATP."),
            (95000, "There are three stages: glycolysis, the Krebs cycle, and the electron transport chain."),
            (210000, "This is going to be on the exam: know where each stage happens in the cell."),
            (330000, "Glycolysis happens in the cytoplasm. It splits glucose into two pyruvate and nets two ATP."),
            (455000, "A common mistake is saying glycolysis needs oxygen. It does not."),
            (600000, "Next, pyruvate moves into the mitochondrial matrix, where the Krebs cycle releases carbon dioxide."),
            (780000, "The Krebs cycle also loads up NADH and FADH2, the electron carriers."),
            (960000, "Those carriers drop their electrons at the electron transport chain in the inner membrane."),
            (1140000, "Remember, oxygen is the final electron acceptor. Without it, the chain backs up."),
            (1320000, "Chemiosmosis means protons flow back through ATP synthase, and that flow makes most of the ATP."),
            (1560000, "So why do you think your muscles burn during a sprint?"),
            (1700000, "Right: without enough oxygen, muscle cells switch to fermentation and make lactic acid."),
            (2700000, "Read chapter 9 before Thursday."),
            (2820000, "Problem set four is due next Monday."),
        ],
        "analysis": {
            "summary": [
                "Cellular respiration turns glucose into ATP in three stages",
                "Glycolysis in the cytoplasm needs no oxygen and nets two ATP",
                "The Krebs cycle in the matrix releases CO2 and loads NADH and FADH2",
                "The electron transport chain uses oxygen as the final electron acceptor and makes most ATP",
                "Without enough oxygen, muscle cells use fermentation and make lactic acid",
            ],
            "watch_for": [
                {"point": "Know where each stage of respiration happens", "why": "exam", "quote": "This is going to be on the exam: know where each stage happens in the cell.", "at_ms": 210000},
                {"point": "Glycolysis does not need oxygen", "why": "mistake", "quote": "A common mistake is saying glycolysis needs oxygen. It does not.", "at_ms": 455000},
                {"point": "Oxygen is the final electron acceptor", "why": "emphasis", "quote": "Remember, oxygen is the final electron acceptor.", "at_ms": 1140000},
            ],
            "terms": [
                {"term": "Glycolysis", "definition": "Splitting glucose into two pyruvate in the cytoplasm, netting two ATP", "at_ms": 330000},
                {"term": "Krebs cycle", "definition": "The cycle in the mitochondrial matrix that releases CO2 and loads NADH and FADH2", "at_ms": 600000},
                {"term": "Chemiosmosis", "definition": "Protons flowing back through ATP synthase, which makes most of the ATP", "at_ms": 1320000},
            ],
            "questions": [{"question": "Why do you think your muscles burn during a sprint?", "at_ms": 1560000}],
            "outline_md": "# Cellular respiration\n## I. Glycolysis\n- In the cytoplasm; no oxygen needed\n- Glucose → two pyruvate; net 2 ATP\n## II. Krebs cycle\n- In the mitochondrial matrix\n- Releases CO2; loads NADH and FADH2\n## III. Electron transport chain\n- In the inner mitochondrial membrane\n- Oxygen is the final electron acceptor\n- ATP synthase makes most ATP (chemiosmosis)\n## IV. Without oxygen\n- Fermentation; muscle cells make lactic acid",
            "my_notes": "Draw the mitochondrion and label where each stage happens. Ask about the ATP count in office hours.",
        },
        "todos": [
            {"title": "Read chapter 9", "kind": "reading", "said": "before Thursday", "days_ahead": 2, "quote": "Read chapter 9 before Thursday.", "at_ms": 2700000},
            {"title": "Problem set 4", "kind": "assignment", "said": "next Monday", "days_ahead": 6, "quote": "Problem set four is due next Monday.", "at_ms": 2820000},
        ],
    },
    {
        "slug": "hist-lecture-4",
        "course": "hist",
        "title": "Lecture 4: The July Crisis of 1914",
        "days_ago": 5,
        "duration_ms": 45 * 60 * 1000,
        "segments": [
            (0, "Today: how one assassination became a world war in about five weeks."),
            (120000, "On the twenty-eighth of June, 1914, Archduke Franz Ferdinand was shot in Sarajevo."),
            (300000, "Germany then gave Austria-Hungary what historians call the blank cheque: unconditional support."),
            (480000, "Austria-Hungary sent Serbia an ultimatum on the twenty-third of July and declared war on the twenty-eighth."),
            (660000, "Don't confuse the spark with the causes. The assassination was the spark; the alliances turned it into a general war."),
            (900000, "Russia mobilized, Germany declared war on Russia and France, and German troops went through Belgium."),
            (1080000, "Britain entered on the fourth of August, and the reason it gave was Belgian neutrality."),
            (1260000, "Write that date down. The fourth of August will come up on the midterm."),
            (1500000, "So, could anyone have stopped it once mobilization started?"),
            (2400000, "Your response paper on the July Crisis is due Friday."),
        ],
        "analysis": {
            "summary": [
                "The assassination of Franz Ferdinand on 28 June 1914 set off the July Crisis",
                "Germany's blank cheque backed Austria-Hungary against Serbia",
                "Alliances and mobilization spread the war across Europe within weeks",
                "Britain entered on 4 August, citing Belgian neutrality",
            ],
            "watch_for": [
                {"point": "Tell the spark apart from the causes", "why": "mistake", "quote": "Don't confuse the spark with the causes.", "at_ms": 660000},
                {"point": "Britain entered the war on 4 August 1914", "why": "exam", "quote": "The fourth of August will come up on the midterm.", "at_ms": 1260000},
            ],
            "terms": [
                {"term": "Blank cheque", "definition": "Germany's promise of unconditional support to Austria-Hungary", "at_ms": 300000},
            ],
            "questions": [{"question": "Could anyone have stopped it once mobilization started?", "at_ms": 1500000}],
            "outline_md": "# The July Crisis of 1914\n## I. The assassination\n- 28 June 1914, Sarajevo: Franz Ferdinand killed\n## II. Escalation\n- Germany's blank cheque to Austria-Hungary\n- Ultimatum to Serbia (23 July); war declared (28 July)\n## III. General war\n- Russia mobilizes; Germany declares war on Russia and France\n- Invasion of Belgium; Britain enters on 4 August",
            "my_notes": "Make a timeline from 28 June to 4 August for the midterm.",
        },
        "todos": [
            {"title": "Response paper on the July Crisis", "kind": "assignment", "said": "Friday", "days_ahead": 4, "quote": "Your response paper on the July Crisis is due Friday.", "at_ms": 2400000},
        ],
    },
]
