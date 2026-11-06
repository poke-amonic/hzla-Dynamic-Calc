// Save reader for Pokemon Isahaya (pokeemerald-expansion based).
// Needs window.isahayaSave (backups/isahaya_save.js, written by dev_scripts/export_dynamic_calc.py).
// The parse core (window.IsahayaSaveReader) has no DOM dependencies; the handler at the bottom
// only binds when the calc is showing the Isahaya data set.
(function () {
    "use strict";

    const SECTOR_SIZE = 0x1000;
    const SECTOR_DATA_SIZE = 3968;
    const SECTORS_PER_SLOT = 14;
    const SECTOR_FOOTER_OFFSET = 0xFF4;
    const SECTOR_SIGNATURE = 0x08012025;

    const SB1_FIRST_SECTOR = 1;
    const SB1_SECTOR_COUNT = 4;
    const STORAGE_FIRST_SECTOR = 5;
    const STORAGE_SECTOR_COUNT = 9;

    const SB1_PARTY_COUNT_OFFSET = 0x234;
    const SB1_PARTY_OFFSET = 0x238;
    const PARTY_MON_SIZE = 100;
    const PARTY_MAX = 6;
    const STORAGE_BOXES_OFFSET = 4;
    const BOX_MON_SIZE = 80;
    const BOX_COUNT = 14;
    const MON_PER_BOX = 30;

    const NATURES = ["Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
        "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
        "Calm", "Gentle", "Sassy", "Careful", "Quirky"];

    const SUBSTRUCT_ORDER = [
        [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
        [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
        [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
        [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
    ];

    // Growth rate ids match include/constants/pokemon.h: 0 medium fast, 1 erratic, 2 fluctuating, 3 medium slow, 4 fast, 5 slow.
    const GROWTH = [
        (n) => n ** 3,
        (n) => n <= 50 ? Math.floor((100 - n) * n ** 3 / 50)
            : n <= 68 ? Math.floor((150 - n) * n ** 3 / 100)
                : n <= 98 ? Math.floor(Math.floor((1911 - 10 * n) / 3) * n ** 3 / 500)
                    : Math.floor((160 - n) * n ** 3 / 100),
        (n) => n <= 15 ? Math.floor((Math.floor((n + 1) / 3) + 24) * n ** 3 / 50)
            : n <= 36 ? Math.floor((n + 14) * n ** 3 / 50)
                : Math.floor((Math.floor(n / 2) + 32) * n ** 3 / 50),
        (n) => Math.floor(6 * n ** 3 / 5) - 15 * n ** 2 + 100 * n - 140,
        (n) => Math.floor(4 * n ** 3 / 5),
        (n) => Math.floor(5 * n ** 3 / 4),
    ];

    function expForLevel(growth, level) {
        if (level <= 0) return 0;
        if (level === 1) return 1;
        return (GROWTH[growth] || GROWTH[0])(level);
    }

    function levelFromExp(growth, exp) {
        let level = 1;
        while (level <= 100 && expForLevel(growth, level) <= exp) level++;
        return Math.min(level - 1, 100);
    }

    function decodeChar(b) {
        if (b >= 0xBB && b <= 0xD4) return String.fromCharCode(65 + b - 0xBB);
        if (b >= 0xD5 && b <= 0xEE) return String.fromCharCode(97 + b - 0xD5);
        if (b >= 0xA1 && b <= 0xAA) return String.fromCharCode(48 + b - 0xA1);
        switch (b) {
            case 0x00: return " ";
            case 0xAB: return "!";
            case 0xAC: return "?";
            case 0xAD: return ".";
            case 0xAE: return "-";
            default: return null;
        }
    }

    function decodeName(bytes) {
        let out = "";
        for (let i = 0; i < bytes.length; i++) {
            if (bytes[i] === 0xFF) break;
            const c = decodeChar(bytes[i]);
            if (c !== null) out += c;
        }
        return out.trim();
    }

    // Counter comparison that survives u32 wrap-around.
    function isNewer(a, b) {
        return a !== b && ((a - b) >>> 0) < 0x80000000;
    }

    function locateSectors(dv) {
        const total = Math.floor(dv.byteLength / SECTOR_SIZE);
        const slots = [{ sectors: {}, counter: null }, { sectors: {}, counter: null }];
        const perId = {};

        for (let phys = 0; phys < total && phys < SECTORS_PER_SLOT * 2; phys++) {
            const base = phys * SECTOR_SIZE;
            const sid = dv.getUint16(base + SECTOR_FOOTER_OFFSET, true);
            const sig = dv.getUint32(base + SECTOR_FOOTER_OFFSET + 4, true);
            const counter = dv.getUint32(base + SECTOR_FOOTER_OFFSET + 8, true);
            if (sig !== SECTOR_SIGNATURE || sid >= SECTORS_PER_SLOT) continue;

            const slot = slots[Math.floor(phys / SECTORS_PER_SLOT)];
            slot.sectors[sid] = base;
            if (slot.counter === null || isNewer(counter, slot.counter)) slot.counter = counter;
            if (!(sid in perId) || isNewer(counter, perId[sid].counter)) perId[sid] = { base, counter };
        }

        const complete = slots.filter((s) => Object.keys(s.sectors).length === SECTORS_PER_SLOT);
        if (complete.length === 2) {
            return isNewer(complete[1].counter, complete[0].counter) ? complete[1].sectors : complete[0].sectors;
        }
        if (complete.length === 1) return complete[0].sectors;

        // Torn save: fall back to the newest copy of each sector.
        const merged = {};
        for (let id = 0; id < SECTORS_PER_SLOT; id++) {
            if (!(id in perId)) throw new Error("Save is missing logical sector " + id + " (is this an Isahaya .sav?)");
            merged[id] = perId[id].base;
        }
        return merged;
    }

    function joinSectors(dv, sectorBases, firstId, count) {
        const out = new Uint8Array(count * SECTOR_DATA_SIZE);
        for (let i = 0; i < count; i++) {
            const base = sectorBases[firstId + i];
            out.set(new Uint8Array(dv.buffer, dv.byteOffset + base, SECTOR_DATA_SIZE), i * SECTOR_DATA_SIZE);
        }
        return out;
    }

    function decodeMon(bytes, offset, isParty, tables) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, isParty ? PARTY_MON_SIZE : BOX_MON_SIZE);
        const pid = dv.getUint32(0, true);
        const otId = dv.getUint32(4, true);
        const flags = dv.getUint8(0x13);
        if (!(flags & 0x02) || (flags & 0x01) || (flags & 0x04)) return null; // no species, bad egg, egg

        const key = (pid ^ otId) >>> 0;
        const words = [];
        let checksum = 0;
        for (let i = 0; i < 12; i++) {
            const w = (dv.getUint32(0x20 + i * 4, true) ^ key) >>> 0;
            words.push(w);
            checksum += (w & 0xFFFF) + (w >>> 16);
        }
        if ((checksum & 0xFFFF) !== dv.getUint16(0x1C, true)) return null;

        const order = SUBSTRUCT_ORDER[pid % 24];
        const sub = [null, null, null, null];
        for (let pos = 0; pos < 4; pos++) sub[order[pos]] = words.slice(pos * 3, pos * 3 + 3);
        const [growthSub, moveSub, evSub, miscSub] = sub;

        const speciesId = growthSub[0] & 0x7FF;
        if (speciesId === 0) return null;
        const species = tables.species[speciesId];
        if (!species) return null;

        const teraType = (growthSub[0] >>> 11) & 0x1F;
        const itemId = (growthSub[0] >>> 16) & 0x3FF;
        const exp = growthSub[1] & 0x1FFFFF;
        const moveIds = [moveSub[0] & 0x7FF, (moveSub[0] >>> 16) & 0x7FF, moveSub[1] & 0x7FF, (moveSub[1] >>> 16) & 0x7FF];
        // Stored order: hp, atk, def, spe, spa, spd
        const evs = [evSub[0] & 0xFF, (evSub[0] >>> 8) & 0xFF, (evSub[0] >>> 16) & 0xFF, (evSub[0] >>> 24) & 0xFF, evSub[1] & 0xFF, (evSub[1] >>> 8) & 0xFF];
        const ivs = [0, 1, 2, 3, 4, 5].map((i) => (miscSub[1] >>> (5 * i)) & 0x1F);
        const abilityNum = (miscSub[2] >>> 29) & 0x3;
        const hiddenNature = dv.getUint8(0x12) >> 3;

        const speciesName = species[0];
        const growth = species[1];
        const abilities = species[2] || [];
        const partyLevel = isParty ? dv.getUint8(0x54) : 0;
        const level = partyLevel >= 1 && partyLevel <= 100 ? partyLevel : levelFromExp(growth, exp);
        const abilityName = abilities[abilityNum] || abilities.find((a) => a) || null;
        const typeName = tables.types[teraType];

        const moveNames = [];
        for (const id of moveIds) {
            if (id === 0) continue;
            const typed = tables.hiddenPower && tables.hiddenPower[id];
            moveNames.push((typed && typed[typeName]) || tables.moves[id] || ("Move-" + id));
        }

        return {
            speciesId,
            speciesName,
            nickname: decodeName(new Uint8Array(bytes.buffer, bytes.byteOffset + offset + 8, 10)),
            level,
            itemName: itemId ? (tables.items[itemId] || null) : null,
            abilityName,
            abilityIndex: abilityNum,
            natureName: NATURES[((pid % 25) ^ hiddenNature) % 25],
            teraType: typeName || null,
            moveNames,
            evs,
            ivs,
            trainerIdSecret: otId >>> 16,
        };
    }

    function parseSave(buffer, tables) {
        tables = tables || window.isahayaSave;
        if (!tables) throw new Error("isahaya_save.js is not loaded");
        const dv = new DataView(buffer);
        const bases = locateSectors(dv);
        const sb1 = joinSectors(dv, bases, SB1_FIRST_SECTOR, SB1_SECTOR_COUNT);
        const storage = joinSectors(dv, bases, STORAGE_FIRST_SECTOR, STORAGE_SECTOR_COUNT);

        const party = [];
        const partyCount = Math.min(sb1[SB1_PARTY_COUNT_OFFSET], PARTY_MAX);
        for (let i = 0; i < partyCount; i++) {
            const mon = decodeMon(sb1, SB1_PARTY_OFFSET + i * PARTY_MON_SIZE, true, tables);
            if (mon) party.push(mon);
        }

        const boxes = [];
        for (let b = 0; b < BOX_COUNT; b++) {
            const box = [];
            for (let s = 0; s < MON_PER_BOX; s++) {
                const mon = decodeMon(storage, STORAGE_BOXES_OFFSET + (b * MON_PER_BOX + s) * BOX_MON_SIZE, false, tables);
                if (mon) {
                    mon.box = b + 1;
                    mon.slot = s + 1;
                    box.push(mon);
                }
            }
            boxes.push(box);
        }
        return { party, boxes };
    }

    function monToShowdown(mon) {
        let lead = mon.speciesName;
        const nick = (mon.nickname || "").replace(/[()]/g, "").trim();
        if (nick && nick.toLowerCase() !== lead.toLowerCase()) lead = nick + " (" + lead + ")";
        if (mon.itemName) lead += " @ " + mon.itemName;

        const statLabels = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
        const showdownOrder = [0, 1, 2, 4, 5, 3];
        const join = (arr) => showdownOrder.map((idx, i) => arr[idx] + " " + statLabels[i]).join(" / ");

        const lines = [lead, "Level: " + mon.level, mon.natureName + " Nature", "EVs: " + join(mon.evs), "IVs: " + join(mon.ivs)];
        if (mon.abilityName) lines.push("Ability: " + mon.abilityName);
        for (const move of mon.moveNames) lines.push("- " + move);
        return lines.join("\n") + "\n\n";
    }

    // The last box is treated as a graveyard, the same way the Imperium reader does.
    function buildImport(result) {
        const live = result.party.concat(...result.boxes.slice(0, BOX_COUNT - 1));
        const graveyard = result.boxes[BOX_COUNT - 1];
        return {
            showdownText: live.map(monToShowdown).join(""),
            importedMonsMetadata: live.map((m) => ({
                speciesName: m.speciesName,
                abilityIndex: m.abilityIndex,
                trainerIdSecret: m.trainerIdSecret,
            })),
            deadMons: graveyard.map((m) => ({
                speciesName: m.speciesName,
                speciesId: m.speciesId,
                nickname: m.nickname || "",
                met: "",
                box: m.box,
                slot: m.slot,
                source: "save-file",
            })),
        };
    }

    window.IsahayaSaveReader = { parseSave, buildImport, monToShowdown, levelFromExp, expForLevel };

    if (typeof document === "undefined" || typeof $ !== "function") return;

    function isIsahaya() {
        return typeof TITLE === "string" && TITLE.includes("Isahaya");
    }

    function showStatus(fileName, counts) {
        const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
        const html = "<h4>Changelog:</h4><p>" + fileName + " loaded at " + stamp + " (" + counts + ")</p>";
        if ($("#changelog").length === 0) $("#clearSets").after("<p id='changelog'></p>");
        $("#changelog").html(html).show();
    }

    function onSaveChosen(event) {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        if (/\.ss\d$/i.test(file.name)) {
            alert("Save states (.ss1 etc.) are not supported for Pokemon Isahaya. Use the in-game save file (.sav).");
            return;
        }
        const reader = new FileReader();
        reader.onload = function (e) {
            let result;
            try {
                result = parseSave(e.target.result);
            } catch (err) {
                console.error("[Isahaya save reader]", err);
                alert("Could not read this save file: " + (err && err.message ? err.message : err));
                return;
            }
            const imported = buildImport(result);
            showStatus(file.name, result.party.length + " party, " +
                result.boxes.slice(0, BOX_COUNT - 1).reduce((n, b) => n + b.length, 0) + " boxed, " +
                result.boxes[BOX_COUNT - 1].length + " graveyard");

            if (typeof window.applyImportedSnapshot === "function") {
                window.applyImportedSnapshot({
                    showdownImport: imported.showdownText,
                    deadMons: imported.deadMons,
                    importedMonsMetadata: imported.importedMonsMetadata,
                    source: "save-file",
                    replaceDeadMons: true,
                });
            } else {
                $(".import-team-text").val(imported.showdownText);
                $("#import").click();
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function bind() {
        if (!isIsahaya()) return;
        if (!window.baseGame) window.baseGame = "isahaya";
        if (typeof syncSaveReaderControls === "function") syncSaveReaderControls();
        else $("#read-save").show();

        const input = document.getElementById("save-upload");
        if (!input || input.dataset.isahayaBound === "1") return;
        input.dataset.isahayaBound = "1";
        $("#read-save").on("click.isahayasave", function () { input.value = null; });
        input.addEventListener("change", onSaveChosen);
    }

    $(document).ready(bind);
})();
