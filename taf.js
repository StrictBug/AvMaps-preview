(() => {
    /**
     * Draft Annex 3-inspired TAF builder for AvMaps.
     * Thresholds are tunable guidance proxies — not a legal encoder.
     */
    const THRESHOLDS = {
        // Gust group only when mean ≥15 kt, gust ≥25 kt, and ≥10 kt above mean (min 15G25).
        gustMeanMinKt: 15,
        gustMinKt: 25,
        gustExcessKt: 10,
        // Never forecast calm 00000KT — floor VRB02KT; VRB direction allowed ≤4 kt.
        windMinKt: 2,
        windVrbMaxKt: 4,
        // Published mean/TEMPO wind speeds (kt). Above 50 → nearest 5.
        windSpeedLadderKt: [
            2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 25, 28, 30,
            32, 35, 38, 40, 42, 45, 48, 50,
        ],
        // Fog categories map into FG (<1000 m) or BR / mist (1000–5000 m).
        visFog: { 3: 400, 2: 1500, 1: 3000 },
        fogVisMaxM: 999,
        mistVisMinM: 1000,
        mistVisMaxM: 5000,
        // PROB fog: F3→300 m FG + BKN001; F1/F2 → BR + BKN002 (lifted fog / very
        // low stratus stays on the PROB — never on the mean as BKN000).
        // Policy F2 alone is treated as mist for draft PROB — not FG.
        visFogProb: { 3: 300, 2: 2000, 1: 2000 },
        fogVisMaxMProb: 999,
        fogProbCloudFt: { 3: 100, 2: 200, 1: 200 },
        // Mean lines never publish BKN/OVC below this (fog/stratus → PROB or FEW005).
        meanMinBknFt: 500,
        meanLowStratusFewFt: 500,
        // Look ahead past TAF validity so upcoming FG/TSRA PROB still appears
        // on shorter drafts (period text may extend past the header end).
        tafForesightHours: 12,
        visTsMm: 2.5,
        // TSRA visibility from CB base (ft AGL).
        visTsCbFt: [
            { maxFt: 3000, visM: 1000 },
            { maxFt: 5000, visM: 2000 },
            { maxFt: 8000, visM: 3000 },
            { maxFt: Infinity, visM: 4000 },
        ],
        // Allow SHRA TEMPO to start up to this many hours after storm PROB ends.
        stormShraAlignGapHours: 1,
        // Skip coincident SHRA TEMPO when storm CB base is above this (high-based).
        stormShraMaxCbBaseFt: 5000,
        // Mildest vis for SHRA TEMPO coincident with low/mid-based TSRA PROB.
        visStormShraM: 4000,
        // RA/SHRA/SN visibility from precip amount (mm/h), heaviest band first.
        visPrecipAmountM: [
            { minMm: 10, visM: 2000 },
            { minMm: 5, visM: 3000 },
            { minMm: 2.5, visM: 4000 },
            { minMm: 1, visM: 5000 },
            { minMm: 0.5, visM: 6000 },
            { minMm: 0.2, visM: 7000 },
        ],
        // DZ visibility from moist-layer proximity (LCL / cloud base AGL ft).
        // Never invent FG-range vis from drizzle alone (floor = visDzMinM).
        visDzByBaseFt: [
            { maxFt: 200, visM: 1500 },
            { maxFt: 500, visM: 2500 },
            { maxFt: 1000, visM: 3000 },
            { maxFt: 1500, visM: 4000 },
        ],
        // Allow low-base DZ down to 1500 m; still no FG-range (<1000) from drizzle alone.
        visDzMinM: 1500,
        visDzFallbackM: 7000,
        cavokVisM: 10000,
        cavokCloudFt: 5000,
        windChangeKt: 10,
        windChangeDeg: 30,
        // TEMPO only for low cloud / vis reductions at or below these ceilings.
        // 7000 m is the light-shower floor — not worth a TEMPO by itself.
        tempoCloudMaxFt: 1500,
        tempoVisMaxM: 6000,
        // Discrete TEMPO change bands (BKN/OVC bases and visibility).
        // 400 sits between 300 and 500 so precip can step BKN005→BKN004 with
        // TSRA PROB still below (BKN003). 800 / 1200 support PROB < TEMPO under
        // a higher mean base.
        tempoCloudBasesFt: [300, 400, 500, 800, 1000, 1200, 1500],
        // Storm PROB may sit below the TEMPO floor (OVC003 TEMPO → BKN002, not 001).
        stormProbCloudBasesFt: [200],
        tempoVisBandsM: [1000, 2500, 4000, 5000, 6000],
        // TEMPO/PROB wind for RA/SHRA when stronger than base and >15G25.
        // Thunderstorm PROB winds are always VRB, at least 15G25 (gust always shown).
        // Peak wind/gust taken over the storm slice; published on this step (kt).
        tempoProbWindWx: ['TSRA', 'SHRA', 'RA'],
        tempoProbWindMinKt: 15,
        tempoProbGustMinKt: 25,
        tempoProbWindDeltaKt: 5,
        stormProbWindStepKt: 5,
        fmMinHours: 3,
        // Mean FM/BECMG: new regime must hold this many hours before emitting.
        meanChangeMinHours: 2,
        // Optional wind-regime mean change (any speed).
        meanOptionalDirDeg: 60,
        // Optional cloud base jump (ft) above amendment ceilings.
        meanOptionalCloudBaseFt: 1000,
        // BECMG transition window (hours) when change is gradual.
        becmgHours: 2,
        // Mean FM/BECMG starting inside this many hours of validity end are low-value
        // (often just wind pickup) — absorb into the prior mean instead.
        meanLateWindowHours: 3,
        // Cloud/vis TEMPO needs ≥2 hours — single-hour BKN spikes are too specific.
        tempoMinHours: 2,
        tempoMaxFraction: 0.75,
        // Storm PROB needs ≥2 hours — single-hour TSRA spikes are too specific.
        stormProbMinHours: 2,
        // Bridge 1-hour holes between storm hours into one PROB spell.
        stormBridgeMaxGapHours: 1,
        // Back-extend TSRA PROB through SHRA/convective lead-in (map-early cells).
        stormProbLeadInHours: 2,
        // Precip mean must clear coincident TEMPO ceiling by at least this (ft).
        precipMeanTempoMinGapFt: 200,
        // Same-code SHRA/RA TEMPOs within this gap merge into one regime TEMPO
        // (avoid chasing mid-spell dry ghosts with FM/-SHRA repeats).
        precipRegimeBridgeHours: 6,
        // Bridge short gaps between similar holdings rather than many tiny TEMPOs.
        tempoBridgeMaxGapHours: 3,
        // 1-hour holes between low-cloud TEMPOs are treated as risky and always closed.
        tempoRiskyGapHours: 1,
        // Diurnal low-cloud / fog bias (generalisation for draft guidance).
        // Overnight/predawn: conservative — bridge short gaps, hold toward sunrise.
        // Afternoon/evening: optimistic — wave off fleeting dry low-cloud TEMPOs.
        overnightBridgeMaxGapHours: 2,
        overnightExtendMaxHours: 4,
        daytimeCloudTempoMinHours: 3,
        predawnHoursBeforeSunrise: 3,
        eveningHoursBeforeSunset: 2,
        // Line-count resistance: soft target, then ramp; hard avoid beyond soft cap.
        // Longer validity → higher budget / slower ramp (ref = 24 h TAF).
        tafSoftLineTarget: 4,
        tafLineSoftCap: 10,
        tafResistanceRefHours: 24,
        // Turbulence RMK is independent of main TAF line pressure; bias above 3 lines.
        // Drop marginal/transient spells — MOD needs a longer run than SEV.
        turbMaxLines: 3,
        turbBridgeMaxGapHours: 2,
        turbMinHours: 3,
        turbModMinHours: 4,
        turbBaseFt: 5000,
        prob40MinHours: 2,
        prob30MinHours: 1,
        nearestIcaoDeg: 0.35,
        precipRainMm: 0.2,
        // Legacy rate hint only — SHRA vs RA is driven by convective precip / ratio.
        precipShowerMm: 1.0,
        precipTsMm: 0.1,
        // Open-Meteo `showers` (convective precip) / Policy ts_precip → SHRA.
        convectivePrecipMinMm: 0.2,
        // TEMPO precip wx (SHRA/RA/SN) only when slice max rate clears this.
        tempoPrecipMinMm: 0.2,
        // Fallback when showers is unavailable (e.g. some ICON paths): CAPE + precip.
        capeShowerMinJkg: 150,
        snowMm: 0.1,
        drizzleRh: 95,
        lowCloudRh: 85,
        fewRh: 80,
        sctRh: 85,
        bknRh: 90,
        ovcRh: 95,
        // Overnight cloud / DZ base: first solid moist level on the OM profile.
        // (Surface LCL is unreliable under a nocturnal inversion; daytime keeps LCL.
        // CCL ≈ LCL in practice — no separate convective-condensation calc.)
        cloudBaseLevelsHpa: [1000, 975, 950, 925, 900, 850],
        cloudBaseMinRh: 95,
        cloudBaseMaxSpreadC: 0.5,
        // Mean / FM line: never publish restricted vis — TEMPO/PROB carry cuts.
        meanVisM: 9999,
        // Precip intensity prefixes (-RA / RA / +RA) from amount.
        wxLightMm: 1.0,
        wxHeavyMm: 5.0,
        // Amendment-sensitive cloud thresholds (every 500 ft up to 1500 ft).
        // Mean parks off 500/1000/1500: 600 / 800 / 1200 / 1800.
        // 800 keeps mean tight over TEMPO OVC005 (BKN012 was too high).
        meanCloudBracketFt: [
            { maxRawFt: 500, meanFt: 600 },
            { maxRawFt: 800, meanFt: 800 },
            { maxRawFt: 1000, meanFt: 1200 },
            { maxRawFt: 1500, meanFt: 1800 },
        ],
        // Mandatory mean ceiling bands (BKN/OVC crossing these requires a mean line).
        meanCeilingBandsFt: [300, 500, 1000, 1500],
    };

    const WX_PRECEDENCE = ['TSRA', 'FZFG', 'FG', 'BR', 'SN', 'SHRA', 'RA', 'DZ'];
    const PROB_WEATHER = new Set(['TSRA', 'FZFG', 'FG', 'BR']);
    // Liquid precip: SHRA supersedes RA/DZ. RA+DZ may combine as RADZ when allowed.
    const LIQUID_PRECIP_WX = ['SHRA', 'RA', 'DZ'];

    /**
     * Collapse weather to Annex-style unique groups (no SHRARA).
     * When allowRaDz is set, RA and DZ may both remain (formatted as RADZ).
     */
    function dedupeWeatherCodes(codes, { allowRaDz = false } = {}) {
        const ordered = WX_PRECEDENCE.filter((code) => (codes || []).includes(code));
        const hasShra = ordered.includes('SHRA');
        const hasRa = ordered.includes('RA');
        return ordered.filter((code) => {
            if (code === 'SHRA') {
                return true;
            }
            if (code === 'RA') {
                return !hasShra;
            }
            if (code === 'DZ') {
                if (hasShra) {
                    return false;
                }
                if (hasRa) {
                    return allowRaDz;
                }
                return true;
            }
            return true;
        });
    }

    /**
     * Intensity prefix for precip groups.
     * meanStyle → always light (-WX). holdingStyle (TEMPO/PROB) → never -WX;
     * +WX only when heavy.
     */
    function wxIntensityPrefix(code, mm, { meanStyle = false, holdingStyle = false } = {}) {
        if (!['RA', 'SHRA', 'SN', 'DZ'].includes(code)) {
            return '';
        }
        // DZ: no intensity marker in this tool.
        if (code === 'DZ') {
            return '';
        }
        if (holdingStyle) {
            if (Number.isFinite(mm) && mm >= (THRESHOLDS.wxHeavyMm || 5)) {
                return '+';
            }
            return '';
        }
        if (meanStyle || !Number.isFinite(mm) || mm < (THRESHOLDS.wxLightMm || 1)) {
            return '-';
        }
        if (mm >= (THRESHOLDS.wxHeavyMm || 5)) {
            return '+';
        }
        return '';
    }

    /**
     * Format weather groups, combining RA+DZ → RADZ when both present.
     * meanStyle: light intensity on the prevailing line (e.g. 9999 -RA).
     * holdingStyle: TEMPO/PROB — never -WX.
     */
    function formatWeatherGroups(codes, hour = null, { meanStyle = false, holdingStyle = false } = {}) {
        const list = dedupeWeatherCodes(codes, { allowRaDz: true });
        if (!list.length) {
            return '';
        }
        const mm = meanStyle ? 0 : precipAmountMm(hour);
        const combineRaDz = list.includes('RA') && list.includes('DZ');
        const parts = [];
        let insertedRadz = false;
        list.forEach((code) => {
            if (combineRaDz && (code === 'RA' || code === 'DZ')) {
                if (!insertedRadz && code === 'RA') {
                    const heavy = !meanStyle && Number.isFinite(mm) && mm >= (THRESHOLDS.wxHeavyMm || 5);
                    parts.push(heavy ? '+RADZ' : 'RADZ');
                    insertedRadz = true;
                }
                return;
            }
            if (code === 'TSRA' || PROB_WEATHER.has(code)) {
                parts.push(code);
                return;
            }
            parts.push(`${wxIntensityPrefix(code, mm, { meanStyle, holdingStyle })}${code}`);
        });
        return parts.join('');
    }

    /** Policy / OM low-cloud cover used for amount gates. */
    function lowCloudCoverRh(hour) {
        return Math.max(
            Number(hour?.lowCloudRh) || 0,
            Number(hour?.omLowCloudCover) || 0,
        );
    }

    /**
     * Dry low cloud may promote FEW/SCT → BKN only when cover supports broken
     * (or fog/precip owns the holding). Marginal moist edges stay SCT/FEW.
     */
    function holdingAllowsBknPromotion(hour) {
        if (!hour) {
            return true;
        }
        if (hourHasFog(hour) || fogPolicyCategory(hour) >= 1) {
            return true;
        }
        if ((hour.weather || []).some((code) => (
            code === 'TSRA'
            || code === 'SHRA'
            || code === 'RA'
            || code === 'DZ'
            || code === 'SN'
        ))) {
            return true;
        }
        if (hasDrizzleSignal(hour) || meaningfulWetPrecip(hour)) {
            return true;
        }
        return lowCloudCoverRh(hour) >= (THRESHOLDS.bknRh || 90);
    }

    /**
     * TEMPO/PROB cloud amounts: never FEW; low non-CB layers prefer BKN when
     * the moist signal is solid. CB stays SCT (or higher) — never FEWxxxCB.
     */
    function promoteHoldingCloudAmounts(clouds, hour = null) {
        const tempoMax = THRESHOLDS.tempoCloudMaxFt || 1500;
        const allowBkn = holdingAllowsBknPromotion(hour);
        return (clouds || []).map((cloud) => {
            if (cloud.convective === 'CB') {
                if (cloud.amount === 'FEW') {
                    return { ...cloud, amount: 'SCT' };
                }
                return cloud;
            }
            if (cloud.amount === 'FEW') {
                // Low FEW on a solid holding → BKN; otherwise SCT (or stay FEW if high).
                if (Number.isFinite(cloud.baseFt) && cloud.baseFt <= tempoMax) {
                    return { ...cloud, amount: allowBkn ? 'BKN' : 'SCT' };
                }
                return { ...cloud, amount: 'SCT' };
            }
            if (
                cloud.amount === 'SCT'
                && allowBkn
                && Number.isFinite(cloud.baseFt)
                && cloud.baseFt <= tempoMax
            ) {
                return { ...cloud, amount: 'BKN' };
            }
            return cloud;
        });
    }

    /**
     * Lift mean/FM BKN bases off amendment thresholds (500 / 1000 / 1500 ft).
     * Targets: ≤500→600, ≤800→800, ≤1000→1200, ≤1500→1800. Mean never uses OVC.
     */
    function meanCloudBaseFt(rawFt) {
        if (!Number.isFinite(rawFt)) {
            return rawFt;
        }
        const bands = THRESHOLDS.meanCloudBracketFt || [];
        const safeMeans = bands.map((band) => band.meanFt);
        // Already parked on a safe inter-threshold height (600 / 800 / 1200 / 1800).
        if (safeMeans.includes(rawFt)) {
            return rawFt;
        }
        if (rawFt > 1500) {
            return snapCloudBaseFt(rawFt);
        }
        for (const band of bands) {
            if (rawFt <= band.maxRawFt) {
                return band.meanFt;
            }
        }
        return snapCloudBaseFt(rawFt);
    }

    /**
     * Mean BKN must not sit on amendment thresholds (500 / 1000 / 1500) —
     * park at 600 / 800 / 1200 / 1800 (e.g. BKN010→BKN008 or BKN012).
     */
    function parkMeanBknBaseFt(rawFt) {
        if (!Number.isFinite(rawFt)) {
            return rawFt;
        }
        const snapped = snapCloudBaseFt(rawFt);
        if (snapped === 500 || snapped === 1000 || snapped === 1500) {
            return meanCloudBaseFt(snapped);
        }
        // Also lift anything ≤1500 through the bracket table when already near a threshold.
        return meanCloudBaseFt(snapped);
    }

    /**
     * Mean BKN stacked just above a precip TEMPO ceiling.
     * BKN004→BKN006, OVC005→BKN008, OVC008→BKN012 (not BKN006 over OVC005).
     */
    function meanBknAboveTempoFt(tempoCloudFt) {
        if (!Number.isFinite(tempoCloudFt)) {
            return null;
        }
        if (tempoCloudFt <= 400) {
            return 600;
        }
        if (tempoCloudFt <= 500) {
            return 800;
        }
        if (tempoCloudFt <= 800) {
            return 1200;
        }
        const lifted = meanCloudBaseFt(tempoCloudFt);
        const padded = Number.isFinite(lifted)
            ? Math.max(lifted, tempoCloudFt + 400)
            : snapCloudBaseFt(tempoCloudFt + 400);
        return parkMeanBknBaseFt(padded);
    }

    /** SCT at TEMPO base + BKN above — precip_storm mean story (e.g. SCT004 BKN006). */
    function precipMeanCloudStack(tempoCloudFt) {
        if (!Number.isFinite(tempoCloudFt)) {
            return [];
        }
        const tempoFt = snapTempoBandAtOrBelow(tempoCloudFt) || tempoCloudFt;
        const bknFt = parkMeanBknBaseFt(
            Math.max(
                meanBknAboveTempoFt(tempoFt) || (tempoFt + 200),
                tempoFt + (THRESHOLDS.precipMeanTempoMinGapFt || 200),
            ),
        );
        return [
            { amount: 'SCT', baseFt: tempoFt },
            { amount: 'BKN', baseFt: bknFt },
        ];
    }

    /**
     * Mean clouds: always BKN (never OVC). Optionally lift off amendment thresholds.
     * Very low ceilings (< meanMinBknFt) are not published as BKN on the mean —
     * callers sanitize those to CAVOK / FEW005 (fog/stratus stays on PROB).
     */
    function bracketMeanClouds(clouds, { lift = false } = {}) {
        return (clouds || []).map((cloud) => {
            if (cloud.convective === 'CB') {
                return { ...cloud };
            }
            if (cloud.amount !== 'BKN' && cloud.amount !== 'OVC') {
                return { ...cloud };
            }
            // Always park off 500/1000/1500; full lift still uses the same brackets.
            const baseFt = parkMeanBknBaseFt(cloud.baseFt);
            void lift;
            if (!Number.isFinite(baseFt)) {
                return { ...cloud, amount: 'BKN' };
            }
            return { ...cloud, amount: 'BKN', baseFt };
        });
    }

    /** Near-surface moist deck / LCL — fog & lifted stratus, not a distinct mean BKN layer. */
    function meanHasShallowMoistDeck(hour) {
        // Precip_storm owns low BKN/SCT (e.g. -SHRA SCT004 BKN006) — not fog PROB.
        if (
            holdingHasPrecipStorm(hour)
            || isPrecipStormCode(primaryPrecipCode(hour))
        ) {
            return false;
        }
        const lcl = Number.isFinite(hour?.lclFt) ? hour.lclFt : null;
        const profile = Number.isFinite(hour?.profileCloudBaseFt) ? hour.profileCloudBaseFt : null;
        const omBase = Number.isFinite(hour?.omCloudBaseFt) ? hour.omCloudBaseFt : null;
        const refDeck = Number.isFinite(profile) ? profile : omBase;
        if (fogPolicyCategory(hour) >= 1 || hourHasFog(hour)) {
            return true;
        }
        if (Number.isFinite(lcl) && lcl < 500) {
            return true;
        }
        if (Number.isFinite(refDeck) && refDeck < 500) {
            return true;
        }
        return false;
    }

    /**
     * Drop fog-depth / shallow-moist BKN/OVC from the mean (PROB BR/FG owns them).
     * Includes parked BKN006 from a snapped 500 ft base. When there is no fog
     * signal but a very low ceiling remains, publish FEW005 as a light hint.
     */
    function sanitizeMeanClouds(clouds, hour = null) {
        const minBkn = THRESHOLDS.meanMinBknFt || 500;
        const fewFt = THRESHOLDS.meanLowStratusFewFt || 500;
        const fogish = fogPolicyCategory(hour) >= 1 || hourHasFog(hour);
        const shallow = meanHasShallowMoistDeck(hour);
        const out = [];
        (clouds || []).forEach((cloud) => {
            if (cloud.convective === 'CB') {
                out.push(cloud);
                return;
            }
            if (
                (cloud.amount === 'BKN' || cloud.amount === 'OVC')
                && Number.isFinite(cloud.baseFt)
            ) {
                // Fog / shallow moist: never keep mean BKN in fog-stratus bands
                // (≤1000 includes parked BKN006/008 from ≤500 LCL).
                if (shallow && cloud.baseFt <= 1000) {
                    return;
                }
                // ≤500 (incl. exact 500 before park) is fog-depth / amendment floor.
                if (cloud.baseFt <= minBkn) {
                    if (fogish || shallow) {
                        return;
                    }
                    out.push({ amount: 'FEW', baseFt: fewFt });
                    return;
                }
            }
            out.push(cloud);
        });
        return out;
    }

    /**
     * Mean FEW/SCT/BKN justified only when the base matches the moist deck and
     * cover supports the amount. Rejects snapped-up LCL under a shallow nocturnal
     * moist layer (fog/PROB or clear — not FEW010 / SCT005 / BKN006).
     */
    function meanFewJustified(hour, cloud) {
        if (!cloud || !Number.isFinite(cloud.baseFt)) {
            return true;
        }
        if (cloud.amount !== 'FEW' && cloud.amount !== 'SCT' && cloud.amount !== 'BKN') {
            return true;
        }
        const baseFt = cloud.baseFt;
        const lcl = Number.isFinite(hour?.lclFt) ? hour.lclFt : null;
        const profile = Number.isFinite(hour?.profileCloudBaseFt) ? hour.profileCloudBaseFt : null;
        const omBase = Number.isFinite(hour?.omCloudBaseFt) ? hour.omCloudBaseFt : null;
        const refDeck = Number.isFinite(profile) ? profile : omBase;
        const cover = lowCloudCoverRh(hour);
        const shallow = meanHasShallowMoistDeck(hour);

        // Mean BKN needs broken-strength cover (marginal edges stay SCT/NSC).
        if (cloud.amount === 'BKN' && cover < (THRESHOLDS.bknRh || 90)) {
            return false;
        }
        // Shallow moist / fog: no mean BKN (PROB BR/FG owns BKN001–006 territory).
        if (cloud.amount === 'BKN' && shallow && baseFt <= 1000) {
            return false;
        }
        // Fog / shallow moist: SCT/FEW ≤1000 is invented mid-fog, not a mean deck
        // (PROB BR/FG owns that layer; elevated SCT030+ may still publish).
        if (
            (cloud.amount === 'FEW' || cloud.amount === 'SCT')
            && shallow
            && baseFt <= 1000
        ) {
            return false;
        }
        // Elevated layer invented from a near-surface LCL (shallow moist / inversion).
        if (Number.isFinite(lcl) && lcl < 500 && baseFt >= 800 && baseFt <= 1500) {
            return false;
        }
        // Published base far from the resolved moist deck — unless an elevated
        // above-fog deck matches (fog LCL vs SCT030 at the inversion).
        const elevated = Number.isFinite(hour?.elevatedCloudBaseFt)
            ? hour.elevatedCloudBaseFt
            : null;
        if (
            Number.isFinite(refDeck)
            && Math.abs(refDeck - baseFt) > 1000
            && !(Number.isFinite(elevated) && Math.abs(elevated - baseFt) <= 1000)
        ) {
            return false;
        }
        // Shallow moist deck only — no distinct layer at ~1000 ft.
        if (Number.isFinite(refDeck) && refDeck < 500 && baseFt >= 800 && baseFt <= 1500) {
            return false;
        }
        // Very low SCT/FEW without near-sat cover — edge signal, not a mean group.
        // Precip_storm keeps SCT at the TEMPO base under mean BKN (SCT004 BKN006).
        if (
            (cloud.amount === 'FEW' || cloud.amount === 'SCT')
            && baseFt <= 500
            && cover < (THRESHOLDS.bknRh || 90)
            && !(
                holdingHasPrecipStorm(hour)
                || isPrecipStormCode(primaryPrecipCode(hour))
            )
        ) {
            return false;
        }
        return true;
    }

    function meanSignificantCloudBaseFt(state) {
        const cloud = (state?.clouds || []).find((entry) => (
            (entry.amount === 'BKN' || entry.amount === 'OVC')
            && entry.convective !== 'CB'
        ));
        return Number.isFinite(cloud?.baseFt) ? cloud.baseFt : null;
    }

    function isMeanChangeGroup(group) {
        return group?.kind === 'FM' || group?.kind === 'BECMG';
    }

    /** True when a TEMPO/PROB holding has BKN/OVC below the (lifted) mean base. */
    function holdingCoversBelowMeanCloud(groups, meanBaseFt) {
        if (!Number.isFinite(meanBaseFt) || !groups?.length) {
            return false;
        }
        return groups.some((group) => {
            if (!group || isMeanChangeGroup(group)) {
                return false;
            }
            const holdingBase = meanSignificantCloudBaseFt(group.state);
            return Number.isFinite(holdingBase) && holdingBase < meanBaseFt;
        });
    }

    /**
     * Apply amendment-threshold cloud lift only when a holding covers lower cloud.
     * Always keeps mean vis/wx rules via normalizeMeanState.
     */
    function applyMeanCloudLiftIfHeld(hour, groups) {
        if (!hour) {
            return hour;
        }
        const lifted = normalizeMeanState(hour, { liftClouds: true });
        const unlifted = normalizeMeanState(hour, { liftClouds: false });
        const liftedFt = meanSignificantCloudBaseFt(lifted);
        if (Number.isFinite(liftedFt) && holdingCoversBelowMeanCloud(groups, liftedFt)) {
            return lifted;
        }
        return unlifted;
    }

    function cloudIsStrongOvercast(hour) {
        return (hour?.lowCloudRh || 0) >= THRESHOLDS.ovcRh
            || (hour?.omLowCloudCover || 0) >= THRESHOLDS.ovcRh;
    }

    /**
     * Holdings may use OVC only when the moist layer is strongly overcast;
     * otherwise keep BKN to avoid overusing OVC.
     */
    function temperHoldingClouds(state) {
        if (!state?.clouds?.length) {
            return state;
        }
        const allowOvc = cloudIsStrongOvercast(state);
        const clouds = state.clouds.map((cloud) => {
            if (cloud.convective === 'CB' || cloud.amount !== 'OVC') {
                return cloud;
            }
            return allowOvc ? cloud : { ...cloud, amount: 'BKN' };
        });
        return { ...state, clouds };
    }

    /**
     * Operational mean / FM line: vis always 9999; fog left to PROB; never OVC;
     * precip kept (e.g. 9999 -RA). Cloud lift off amendment thresholds is optional
     * (only when a holding covers lower cloud — see applyMeanCloudLiftIfHeld).
     */
    function normalizeMeanState(hour, { liftClouds = false } = {}) {
        if (!hour) {
            return hour;
        }
        const weather = dedupeWeatherCodes(
            (hour.weather || []).filter((code) => !PROB_WEATHER.has(code) && code !== 'TSRA'),
        );
        let clouds = sanitizeMeanClouds(
            bracketMeanClouds(hour.clouds || [], { lift: liftClouds }),
            hour,
        );
        // Soft-demote mean BKN when cover is only SCT-strength, then drop unjustified layers.
        clouds = clouds.map((cloud) => {
            if (
                cloud.amount === 'BKN'
                && cloud.convective !== 'CB'
                && lowCloudCoverRh(hour) < (THRESHOLDS.bknRh || 90)
            ) {
                return { ...cloud, amount: 'SCT' };
            }
            return cloud;
        }).filter((cloud) => meanFewJustified(hour, cloud));
        // CAVOK: no cloud below 5000 ft. Justified FEW can block CAVOK / open a mean line.
        const hasCloudBelowCavok = clouds.some((cloud) => (
            cloud.convective !== 'CB'
            && Number.isFinite(cloud.baseFt)
            && cloud.baseFt < THRESHOLDS.cavokCloudFt
            && ['FEW', 'SCT', 'BKN', 'OVC'].includes(cloud.amount)
        ));
        const visM = THRESHOLDS.meanVisM || 9999;
        const cavok = weather.length === 0 && !hasCloudBelowCavok;
        const windKt = publishedWindKt(hour);
        const gustKt = Number.isFinite(hour.gustKt) ? roundWindKt(hour.gustKt) : hour.gustKt;
        return {
            ...hour,
            weather,
            clouds: cavok ? [] : clouds,
            visM,
            cavok,
            windKt,
            gustKt,
            windGroup: formatWindGroup(windKt, hour.windDir, gustKt),
        };
    }

    /** Mean-line weather key (excludes PROB-only groups). */
    function meanWxKey(state) {
        return dedupeWeatherCodes(
            (state?.weather || []).filter((code) => !PROB_WEATHER.has(code) && code !== 'TSRA'),
        ).join('/');
    }

    function windAmendmentCapable(state) {
        return (state?.windKt || 0) >= (THRESHOLDS.gustMeanMinKt || 15)
            || (state?.gustKt || 0) >= (THRESHOLDS.gustMinKt || 25);
    }

    /**
     * Ceiling band index for mandatory mean amendments.
     * null = no BKN/OVC below/at the top amendment band (above 1500 / clear).
     */
    function meanCeilingBandIndex(baseFt) {
        if (!Number.isFinite(baseFt)) {
            return null;
        }
        const bands = THRESHOLDS.meanCeilingBandsFt || [300, 500, 1000, 1500];
        for (let index = 0; index < bands.length; index += 1) {
            if (baseFt <= bands[index]) {
                return index;
            }
        }
        return null;
    }

    function primaryMeanCloud(state) {
        const clouds = state?.clouds || [];
        const significant = clouds.find((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC')
            && cloud.convective !== 'CB'
        ));
        if (significant) {
            return significant;
        }
        return clouds.find((cloud) => cloud.convective !== 'CB') || null;
    }

    /**
     * Classify change between two mean states.
     * Returns 'mandatory' | 'optional' | null.
     */
    function classifyMeanChange(prev, next) {
        if (!prev || !next) {
            return null;
        }
        const prevCeil = meanSignificantCloudBaseFt(prev);
        const nextCeil = meanSignificantCloudBaseFt(next);
        if (meanCeilingBandIndex(prevCeil) !== meanCeilingBandIndex(nextCeil)) {
            return 'mandatory';
        }
        const dirDiff = angularDiff(prev.windDir, next.windDir);
        if (
            dirDiff > (THRESHOLDS.windChangeDeg || 30)
            && (windAmendmentCapable(prev) || windAmendmentCapable(next))
        ) {
            return 'mandatory';
        }
        const optionalDir = THRESHOLDS.meanOptionalDirDeg || 60;
        if (dirDiff >= optionalDir) {
            return 'optional';
        }
        if (meanWxKey(prev) !== meanWxKey(next)) {
            return 'optional';
        }
        const prevCloud = primaryMeanCloud(prev);
        const nextCloud = primaryMeanCloud(next);
        const prevAmt = prevCloud?.amount || 'NSC';
        const nextAmt = nextCloud?.amount || 'NSC';
        // FEW may open an optional mean (vicinity / slight low-cloud risk) when justified.
        if (prevAmt !== nextAmt) {
            return 'optional';
        }
        const prevBase = prevCloud?.baseFt;
        const nextBase = nextCloud?.baseFt;
        const jumpFt = THRESHOLDS.meanOptionalCloudBaseFt || 1000;
        if (
            Number.isFinite(prevBase)
            && Number.isFinite(nextBase)
            && Math.abs(prevBase - nextBase) >= jumpFt
        ) {
            return 'optional';
        }
        // Sustained wind pickup/drop (e.g. late-morning 06→15 kt) — optional FM.
        // Compare published ladder speeds so 21→24 (both → 22) is not a change.
        if (
            Math.abs(publishedWindKt(prev) - publishedWindKt(next))
            >= (THRESHOLDS.windChangeKt || 10)
        ) {
            return 'optional';
        }
        return null;
    }

    function signedDirDiff(fromDir, toDir) {
        if (!Number.isFinite(fromDir) || !Number.isFinite(toDir)) {
            return 0;
        }
        let diff = (toDir - fromDir) % 360;
        if (diff > 180) {
            diff -= 360;
        }
        if (diff < -180) {
            diff += 360;
        }
        return diff;
    }

    /** Prefer BECMG when wind/ceiling evolve progressively across 1–2 hours. */
    function isGradualMeanTransition(means, breakIndex) {
        if (breakIndex < 1 || breakIndex >= means.length) {
            return false;
        }
        const a = means[breakIndex - 1];
        const b = means[breakIndex];
        const c = means[Math.min(means.length - 1, breakIndex + 1)];
        const d1 = signedDirDiff(a.windDir, b.windDir);
        const d2 = signedDirDiff(b.windDir, c.windDir);
        if (d1 !== 0 && d2 !== 0 && Math.sign(d1) === Math.sign(d2) && Math.abs(d1) + Math.abs(d2) >= 20) {
            return true;
        }
        const ca = meanSignificantCloudBaseFt(a);
        const cb = meanSignificantCloudBaseFt(b);
        const cc = meanSignificantCloudBaseFt(c);
        if (Number.isFinite(ca) && Number.isFinite(cb) && Number.isFinite(cc)) {
            const step1 = cb - ca;
            const step2 = cc - cb;
            if (step1 !== 0 && step2 !== 0 && Math.sign(step1) === Math.sign(step2)) {
                return true;
            }
        }
        const wa = meanWxKey(a);
        const wb = meanWxKey(b);
        const wc = meanWxKey(c);
        if (wa && wa === wb && !wc) {
            return true;
        }
        if (!wa && wb && wb === wc) {
            return true;
        }
        return false;
    }

    function meanSegmentRepresentative(means, start, end) {
        const slice = means.slice(start, end + 1);
        return normalizeMeanState(dominantState(slice) || slice[0], { liftClouds: false });
    }

    /**
     * Body signature ignoring wind — used to collapse progressive wind-only means
     * (e.g. CAVOK veering 290→270→260 should be one FM, not three).
     * CAVOK bodies collapse together regardless of residual FEW/SCT layers.
     */
    function meanBodyKey(state) {
        if (state?.cavok) {
            return 'CAVOK';
        }
        const cloud = primaryMeanCloud(state);
        return [
            meanWxKey(state) || '-',
            meanCeilingBandIndex(meanSignificantCloudBaseFt(state)) ?? 'hi',
            cloud?.amount || 'NSC',
            Number.isFinite(cloud?.baseFt) ? Math.round(cloud.baseFt / 500) * 500 : '-',
        ].join('|');
    }

    /** Vector-average wind of two mean states; keep later non-wind fields. */
    function blendMeanWindStates(a, b) {
        if (!a) {
            return b;
        }
        if (!b) {
            return a;
        }
        const toRad = (deg) => ((Number(deg) || 0) * Math.PI) / 180;
        const k1 = a.windKt || 0;
        const k2 = b.windKt || 0;
        const x = (k1 * Math.cos(toRad(a.windDir))) + (k2 * Math.cos(toRad(b.windDir)));
        const y = (k1 * Math.sin(toRad(a.windDir))) + (k2 * Math.sin(toRad(b.windDir)));
        const windKt = Math.round((k1 + k2) / 2);
        let windDir = Math.round(((Math.atan2(y, x) * 180) / Math.PI) / 10) * 10;
        windDir = ((windDir % 360) + 360) % 360;
        if (windDir === 0 && windKt > 0) {
            windDir = 360;
        }
        const gustKt = Math.max(a.gustKt || 0, b.gustKt || 0);
        return normalizeMeanState({
            ...b,
            windKt,
            windDir,
            gustKt,
        }, { liftClouds: false });
    }

    /**
     * Collapse consecutive FM/BECMG that share the same body (cavok/wx/ceiling)
     * when wind only veers modestly (< optional dir threshold). Prevents a staircase
     * of mandatory wind amendments through a progressive trough/sea-breeze veer.
     */
    function isHoldingDrivenMean(group) {
        return Boolean(group?.meanSource && String(group.meanSource).startsWith('holding'));
    }

    function collapseSameBodyMeanGroups(groups) {
        if (!groups?.length) {
            return groups || [];
        }
        const maxAbsorbDir = THRESHOLDS.meanOptionalDirDeg || 60;
        const out = [];
        groups.forEach((group) => {
            const prev = out[out.length - 1];
            // Holding-driven onset/cessation/transition means must keep their own times.
            if (
                prev
                && isMeanChangeGroup(prev)
                && isMeanChangeGroup(group)
                && isHoldingDrivenMean(prev) !== isHoldingDrivenMean(group)
            ) {
                out.push({ ...group, state: group.state ? { ...group.state } : group.state });
                return;
            }
            if (
                prev
                && isMeanChangeGroup(prev)
                && isMeanChangeGroup(group)
                && isHoldingDrivenMean(prev)
                && isHoldingDrivenMean(group)
                && prev.meanSource !== group.meanSource
            ) {
                out.push({ ...group, state: group.state ? { ...group.state } : group.state });
                return;
            }
            if (
                prev
                && isMeanChangeGroup(prev)
                && isMeanChangeGroup(group)
                && meanBodyKey(prev.state) === meanBodyKey(group.state)
                && angularDiff(prev.state.windDir, group.state.windDir) < maxAbsorbDir
                // Don't absorb a real wind-speed regime change (e.g. 06→15 kt pickup).
                && Math.abs(publishedWindKt(prev.state) - publishedWindKt(group.state))
                    < (THRESHOLDS.windChangeKt || 10)
                && !isHoldingDrivenMean(prev)
                && !isHoldingDrivenMean(group)
            ) {
                prev.state = blendMeanWindStates(prev.state, group.state);
                // Keep the earlier change time / kind (usually the regime-onset FM).
                prev.requireNsw = Boolean(prev.requireNsw || group.requireNsw);
                prev.meanPriority = prev.meanPriority === 'mandatory' || group.meanPriority === 'mandatory'
                    ? 'mandatory'
                    : (prev.meanPriority || group.meanPriority || 'optional');
                return;
            }
            out.push({ ...group, state: group.state ? { ...group.state } : group.state });
        });
        return out;
    }

    /** Hourly mean state nearest to atMs (not after last published hour). */
    function meanStateNearTime(publishedHours, headerBase, atMs) {
        if (!publishedHours?.length) {
            return normalizeMeanState(headerBase, { liftClouds: false });
        }
        let best = publishedHours[0];
        publishedHours.forEach((hour) => {
            const t = hour.validTime.getTime();
            if (t <= atMs) {
                best = hour;
            }
        });
        return normalizeMeanState(best || headerBase, { liftClouds: false });
    }

    /** SHRA/RA/SN — not DZ (DZ stays on cloud_br / TEMPO path). */
    function isPrecipStormCode(code) {
        return code === 'SHRA' || code === 'RA' || code === 'SN';
    }

    function holdingHasPrecipStorm(state) {
        return hourHasTs(state) || isPrecipStormCode(primaryPrecipCode(state));
    }

    /**
     * Cluster TEMPO/PROB holdings into episodes and tag cloud_br vs precip_storm.
     * A single TAF may contain both classes in different time windows.
     */
    function classifyHoldingEpisodes(tempoGroups, probGroups) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const bridgeMs = 2 * 60 * 60 * 1000;
        const items = [
            ...(tempoGroups || []),
            ...(probGroups || []).filter((group) => (
                hourHasFog(group.state) || hourHasTs(group.state) || fogPolicyCategory(group.state) >= 1
            )),
        ].slice().sort(byStart);
        if (!items.length) {
            return [];
        }
        const itemIsStormish = (item) => holdingHasPrecipStorm(item.state);
        const clusters = [];
        items.forEach((item) => {
            const last = clusters[clusters.length - 1];
            const stormish = itemIsStormish(item);
            if (last && item.startMs <= last.endMs + bridgeMs) {
                const lastStormish = last.items.some(itemIsStormish);
                // Do not bridge dry cloud/BR into SHRA/RA/TSRA (or the reverse).
                const compatible = lastStormish === stormish
                    || (!stormish && !lastStormish);
                if (compatible) {
                    last.endMs = Math.max(last.endMs, item.endExclusiveMs);
                    last.items.push(item);
                    return;
                }
            }
            clusters.push({
                startMs: item.startMs,
                endMs: item.endExclusiveMs,
                items: [item],
            });
        });
        return clusters.map((cluster) => {
            const tempos = cluster.items.filter((item) => item.kind === 'TEMPO');
            const probs = cluster.items.filter((item) => (
                item.kind === 'PROB30' || item.kind === 'PROB40'
            ));
            const hasPrecipStorm = cluster.items.some((item) => holdingHasPrecipStorm(item.state));
            const className = hasPrecipStorm ? 'precip_storm' : 'cloud_br';
            if (className === 'cloud_br') {
                const useful = tempos.some(isLowCloudTempo)
                    || probs.some((group) => hourHasFog(group.state) || fogPolicyCategory(group.state) >= 1)
                    || tempos.some((group) => primaryPrecipCode(group.state) === 'DZ');
                if (!useful) {
                    return null;
                }
            }
            return {
                class: className,
                startMs: cluster.startMs,
                endMs: cluster.endMs,
                tempos,
                probs,
            };
        }).filter(Boolean);
    }

    /** Prefer FM; BECMG when the hourly mean evolves gradually across 1–2 h. */
    function chooseMeanChangeKind(publishedHours, atMs) {
        if (!publishedHours?.length || !Number.isFinite(atMs)) {
            return 'FM';
        }
        const means = publishedHours.map((hour) => normalizeMeanState(hour, { liftClouds: false }));
        let index = 0;
        publishedHours.forEach((hour, hourIndex) => {
            if (hour.validTime.getTime() <= atMs) {
                index = hourIndex;
            }
        });
        if (index > 0 && isGradualMeanTransition(means, index)) {
            return 'BECMG';
        }
        return 'FM';
    }

    function makeHoldingMeanGroup({
        atMs,
        state,
        meanSource,
        meanPriority,
        requireNsw = false,
        publishedHours = null,
        forceKind = null,
    }) {
        const becmgHours = Math.max(1, Math.min(2, THRESHOLDS.becmgHours || 2));
        const kind = forceKind || chooseMeanChangeKind(publishedHours, atMs);
        if (kind === 'BECMG') {
            return {
                kind: 'BECMG',
                meanPriority,
                meanSource,
                requireNsw,
                state,
                startMs: atMs,
                endExclusiveMs: atMs + (becmgHours * 60 * 60 * 1000),
                sortKey: atMs,
                text: '',
            };
        }
        return {
            kind: 'FM',
            meanPriority,
            meanSource,
            requireNsw,
            state,
            startMs: atMs,
            endExclusiveMs: atMs,
            sortKey: atMs,
            text: '',
        };
    }

    /**
     * When precip_storm TEMPO covers TAF start, seed the header with light precip
     * and SCT+BKN stack. Holding-onset FM is skipped at T0 — without this the
     * header stays dry BKN006 over TEMPO SHRA OVC005.
     */
    function seedHeaderFromOpeningPrecip(base, groups, tafStartMs) {
        if (!base || !Number.isFinite(tafStartMs)) {
            return base;
        }
        const opening = (groups || []).find((group) => (
            group.kind === 'TEMPO'
            && group.startMs <= tafStartMs
            && group.endExclusiveMs > tafStartMs
            && isPrecipStormCode(primaryPrecipCode(group.state))
        ));
        if (!opening) {
            return base;
        }
        const code = primaryPrecipCode(opening.state);
        if (!code) {
            return base;
        }
        let tempoFt = lowCeilingCloud(opening.state)?.baseFt;
        const meanFt = meanSignificantCloudBaseFt(base);
        const minGap = THRESHOLDS.precipMeanTempoMinGapFt || 200;
        if (Number.isFinite(tempoFt)) {
            // Only drop a band when the mean/TEMPO gap is too tight — never when
            // already stacked (e.g. BKN006 over BKN004). Prefer 400 under BKN006
            // (not 300) so PROB can sit at BKN003.
            const tight = !Number.isFinite(meanFt) || meanFt - tempoFt < minGap;
            if (tight) {
                let targetTempo = nextLowerTempoBand(tempoFt);
                targetTempo = snapTempoBandAtOrBelow(targetTempo);
                if (
                    Number.isFinite(meanFt)
                    && meanFt <= 600
                    && targetTempo < 400
                    && (THRESHOLDS.tempoCloudBasesFt || []).includes(400)
                    && meanFt - 400 >= minGap
                ) {
                    targetTempo = 400;
                }
                if (Number.isFinite(targetTempo) && targetTempo < tempoFt) {
                    opening.state = setLowCeilingCloud(opening.state, targetTempo, 'FORCE_BKN');
                    tempoFt = targetTempo;
                }
            }
        }
        const clouds = Number.isFinite(tempoFt)
            ? precipMeanCloudStack(tempoFt)
            : (base.clouds || []);
        return normalizeMeanState({
            ...base,
            weather: dedupeWeatherCodes([
                code,
                ...(base.weather || []).filter((wx) => !isPrecipStormCode(wx)),
            ]),
            clouds,
            cavok: false,
        }, { liftClouds: false });
    }

    /**
     * Build FM/BECMG means from precip_storm TEMPO structure: onset (-SHRA/-RA),
     * optional SHRA→RA transition, and cessation (NSW/CAVOK). DZ-only stays on
     * the cloud_br BECMG path.
     */
    function buildMeanGroupsFromHoldings(headerBase, tempoGroups, publishedHours) {
        const precipTempos = (tempoGroups || [])
            .filter((group) => group.kind === 'TEMPO' && isPrecipStormCode(primaryPrecipCode(group.state)))
            .slice()
            .sort((a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey);
        if (!precipTempos.length || !publishedHours?.length) {
            return [];
        }
        const tafStartMs = publishedHours[0].validTime.getTime();
        const lastHourMs = publishedHours[publishedHours.length - 1].validTime.getTime();
        const tafEndExclusiveMs = lastHourMs + (60 * 60 * 1000);
        const groups = [];

        const withMeanPrecip = (baseState, code, { liftClouds = true, tempoCloudFt = null } = {}) => {
            const weather = code ? [code] : [];
            let clouds = baseState.clouds || [];
            if (code && Number.isFinite(tempoCloudFt)) {
                clouds = precipMeanCloudStack(tempoCloudFt);
            }
            return normalizeMeanState({
                ...baseState,
                weather,
                clouds,
                cavok: false,
            }, { liftClouds });
        };

        // Onset only when the first precip TEMPO starts after TAF begin (else header).
        const first = precipTempos[0];
        if (first.startMs > tafStartMs) {
            const code = primaryPrecipCode(first.state);
            const tempoCloudFt = lowCeilingCloud(first.state)?.baseFt;
            const baseState = meanStateNearTime(publishedHours, headerBase, first.startMs);
            const state = withMeanPrecip(baseState, code, { tempoCloudFt });
            groups.push(makeHoldingMeanGroup({
                atMs: first.startMs,
                state,
                meanSource: 'holding-onset',
                meanPriority: 'mandatory',
                publishedHours,
                forceKind: 'FM',
            }));
        }

        // Abutting SHRA→RA (or other code change) only — not mid-spell SHRA ghosts.
        for (let index = 1; index < precipTempos.length; index += 1) {
            const prev = precipTempos[index - 1];
            const edge = precipTempos[index];
            const gap = gapHoursBetween(prev.endExclusiveMs, edge.startMs);
            if (gap >= 1) {
                continue;
            }
            const prevCode = primaryPrecipCode(prev.state);
            const nextCode = primaryPrecipCode(edge.state);
            if (!prevCode || !nextCode || prevCode === nextCode) {
                continue;
            }
            const tempoCloudFt = lowCeilingCloud(edge.state)?.baseFt;
            const baseState = meanStateNearTime(publishedHours, headerBase, edge.startMs);
            const state = withMeanPrecip(baseState, nextCode, { tempoCloudFt });
            groups.push(makeHoldingMeanGroup({
                atMs: edge.startMs,
                state,
                meanSource: 'holding-transition',
                meanPriority: 'mandatory',
                publishedHours,
                forceKind: 'FM',
            }));
        }

        // Single cessation after the last precip TEMPO — definitive regime clear.
        // Keep whenever ≥1 h remains in the TAF (not line-budget optional).
        const last = precipTempos[precipTempos.length - 1];
        const clearHoursLeft = (tafEndExclusiveMs - last.endExclusiveMs) / (60 * 60 * 1000);
        if (clearHoursLeft >= 1) {
            const baseState = meanStateNearTime(publishedHours, headerBase, last.endExclusiveMs);
            let clouds = (baseState.clouds || []).filter((cloud) => (
                cloud.convective === 'CB'
                || cloud.amount === 'FEW'
                || cloud.amount === 'SCT'
                || !(
                    (cloud.amount === 'BKN' || cloud.amount === 'OVC')
                    && cloud.baseFt < (THRESHOLDS.cavokCloudFt || 5000)
                )
            ));
            // Improving regime: show residual FEW if the profile still has a deck.
            const hasFewSct = clouds.some((cloud) => (
                cloud.amount === 'FEW' || cloud.amount === 'SCT'
            ));
            if (!hasFewSct) {
                const elev = elevatedDeckFtFromState(baseState) || 1500;
                clouds = [{ amount: 'FEW', baseFt: snapCloudBaseFt(Math.max(1200, elev)) }];
            }
            const state = normalizeMeanState({
                ...baseState,
                weather: [],
                clouds,
                cavok: false,
            }, { liftClouds: false });
            groups.push(makeHoldingMeanGroup({
                atMs: last.endExclusiveMs,
                state,
                meanSource: 'holding-cessation',
                meanPriority: 'mandatory',
                requireNsw: true,
                publishedHours,
                forceKind: 'FM',
            }));
        }
        return groups;
    }

    /**
     * One prevailing shower regime: merge same-code SHRA/RA TEMPOs across short
     * gaps, and drop dry low-cloud TEMPOs inside that span (or under TSRA PROB).
     * Avoids FM/-SHRA repeats and overlapping dry BKN015 ghosts.
     */
    function consolidatePrecipStormRegime(tempoGroups, probGroups = []) {
        const bridgeHours = THRESHOLDS.precipRegimeBridgeHours || 6;
        const tempos = (tempoGroups || []).slice();
        if (!tempos.length) {
            return tempos;
        }

        const isPrecipTempo = (group) => (
            group?.kind === 'TEMPO'
            && isPrecipStormCode(primaryPrecipCode(group.state))
        );
        const precipTempos = tempos
            .filter(isPrecipTempo)
            .slice()
            .sort((a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0));
        const dryTempos = tempos.filter(isDryLowCloudTempo);
        const otherTempos = tempos.filter((group) => (
            !isPrecipTempo(group) && !isDryLowCloudTempo(group)
        ));

        const mergedPrecip = [];
        precipTempos.forEach((tempo) => {
            const last = mergedPrecip[mergedPrecip.length - 1];
            const code = primaryPrecipCode(tempo.state);
            const lastCode = last ? primaryPrecipCode(last.state) : null;
            const gap = last
                ? gapHoursBetween(last.endExclusiveMs, tempo.startMs)
                : Number.POSITIVE_INFINITY;
            if (
                last
                && lastCode
                && code
                && lastCode === code
                && gap >= 0
                && gap <= bridgeHours
            ) {
                last.endExclusiveMs = Math.max(last.endExclusiveMs, tempo.endExclusiveMs);
                const lastVis = Number.isFinite(last.state?.visM) ? last.state.visM : 9999;
                const nextVis = Number.isFinite(tempo.state?.visM) ? tempo.state.visM : 9999;
                const lastBase = lowCeilingCloud(last.state)?.baseFt;
                const nextBase = lowCeilingCloud(tempo.state)?.baseFt;
                let clouds = last.state?.clouds || [];
                if (
                    Number.isFinite(nextBase)
                    && (!Number.isFinite(lastBase) || nextBase < lastBase)
                ) {
                    clouds = cloneHourState(tempo.state).clouds || clouds;
                }
                last.state = {
                    ...cloneHourState(last.state),
                    weather: dedupeWeatherCodes([
                        ...(last.state.weather || []),
                        ...(tempo.state.weather || []),
                    ]),
                    visM: Math.min(lastVis, nextVis),
                    clouds,
                    cavok: false,
                };
                last.text = '';
                return;
            }
            mergedPrecip.push({
                ...tempo,
                state: cloneHourState(tempo.state),
                text: '',
            });
        });

        const regimeStart = mergedPrecip.length
            ? Math.min(...mergedPrecip.map((group) => group.startMs))
            : null;
        const regimeEnd = mergedPrecip.length
            ? Math.max(...mergedPrecip.map((group) => group.endExclusiveMs))
            : null;
        const stormWindows = (probGroups || []).filter((group) => hourHasTs(group.state));

        const keptDry = dryTempos.filter((dry) => {
            if (
                Number.isFinite(regimeStart)
                && rangesOverlap(dry.startMs, dry.endExclusiveMs, regimeStart, regimeEnd)
            ) {
                return false;
            }
            if (stormWindows.some((storm) => rangesOverlap(
                dry.startMs,
                dry.endExclusiveMs,
                storm.startMs,
                storm.endExclusiveMs,
            ))) {
                return false;
            }
            return true;
        }).map((dry) => ({
            ...dry,
            state: cloneHourState(dry.state),
            text: '',
        }));

        return [...otherTempos, ...mergedPrecip, ...keptDry]
            .sort((a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0));
    }

    function meanScatteredBaseFt(state) {
        const bases = (state?.clouds || [])
            .filter((cloud) => (
                (cloud.amount === 'FEW' || cloud.amount === 'SCT')
                && cloud.convective !== 'CB'
                && Number.isFinite(cloud.baseFt)
            ))
            .map((cloud) => cloud.baseFt);
        return bases.length ? Math.min(...bases) : null;
    }

    function isDryLowCloudTempo(group) {
        return group?.kind === 'TEMPO'
            && Number.isFinite(lowCeilingCloud(group.state)?.baseFt)
            && !holdingHasPrecipStorm(group.state)
            && !hourHasFog(group.state)
            && !tempoHasPrecip(group.state);
    }

    /**
     * Dry low-cloud story: TEMPO BKN sits at the mean deck (not invented lower),
     * TEMPO-window mean carries SCT at that base, and lead-in softens to FEW higher up
     * (e.g. FEW020 → SCT015 + TEMPO BKN015 → CAVOK).
     */
    function refineDryLowCloudMeanTempoStory(groups) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const means = groups.filter(isMeanChangeGroup).slice().sort(byStart);
        const tempos = groups.filter(isDryLowCloudTempo).slice().sort(byStart);
        if (!means.length || !tempos.length) {
            return groups;
        }
        const fogHoldings = (groups || []).filter((group) => (
            (group.kind === 'PROB30' || group.kind === 'PROB40' || group.kind === 'TEMPO')
            && (hourHasFog(group.state) || fogPolicyCategory(group.state) >= 1)
        ));
        const abutMs = 2 * 60 * 60 * 1000;

        tempos.forEach((tempo) => {
            // Fog/BR PROB owns the shallow moist story — don't pin SCT010 to a dry TEMPO.
            const fogAdjacent = fogHoldings.some((holding) => (
                rangesOverlap(
                    tempo.startMs,
                    tempo.endExclusiveMs,
                    holding.startMs,
                    holding.endExclusiveMs,
                )
                || Math.abs(tempo.startMs - holding.endExclusiveMs) <= abutMs
                || Math.abs(holding.startMs - tempo.endExclusiveMs) <= abutMs
            ));
            if (fogAdjacent) {
                return;
            }
            let tempoBase = lowCeilingCloud(tempo.state)?.baseFt;
            if (!Number.isFinite(tempoBase)) {
                return;
            }

            // Deck hint from overlapping + nearby lead-in means (SCT/FEW/BKN).
            let deckFt = null;
            means.forEach((mean, index) => {
                const { start, end } = meanActiveWindow(means, index);
                const overlaps = rangesOverlap(start, end, tempo.startMs, tempo.endExclusiveMs);
                const leadIn = end > tempo.startMs - (3 * 60 * 60 * 1000) && end <= tempo.startMs + (60 * 60 * 1000);
                if (!overlaps && !leadIn) {
                    return;
                }
                const bknFt = meanSignificantCloudBaseFt(mean.state);
                const sctFt = meanScatteredBaseFt(mean.state);
                [bknFt, sctFt].forEach((baseFt) => {
                    if (!Number.isFinite(baseFt)) {
                        return;
                    }
                    deckFt = deckFt == null ? baseFt : Math.max(deckFt, baseFt);
                });
            });
            // Profile/LCL on the TEMPO hour as a floor when means were already stripped.
            const profile = Number.isFinite(tempo.state?.profileCloudBaseFt)
                ? tempo.state.profileCloudBaseFt
                : null;
            const omBase = Number.isFinite(tempo.state?.omCloudBaseFt) ? tempo.state.omCloudBaseFt : null;
            const refDeck = Number.isFinite(profile) ? profile : omBase;
            if (Number.isFinite(refDeck) && refDeck >= 800) {
                deckFt = deckFt == null ? refDeck : Math.max(deckFt, refDeck);
            }

            // Raise dry TEMPO up to the mean deck — don't invent BKN010 under SCT015.
            if (Number.isFinite(deckFt) && tempoBase < deckFt) {
                const raised = snapTempoCloudBaseFt(deckFt) || snapTempoBandAtOrBelow(deckFt);
                if (Number.isFinite(raised) && raised > tempoBase) {
                    tempo.state = temperHoldingClouds(setLowCeilingCloud(tempo.state, raised, 'FORCE_BKN'));
                    tempoBase = raised;
                }
            }

            means.forEach((mean, index) => {
                const { start, end } = meanActiveWindow(means, index);
                const overlaps = rangesOverlap(start, end, tempo.startMs, tempo.endExclusiveMs);
                const beforeTempo = end <= tempo.startMs && end > tempo.startMs - (6 * 60 * 60 * 1000);
                if (overlaps) {
                    // TEMPO window mean: SCT at TEMPO base (never CAVOK over dry BKN TEMPO).
                    mean.state = normalizeMeanState({
                        ...mean.state,
                        weather: mean.state.weather || [],
                        clouds: [{ amount: 'SCT', baseFt: tempoBase }],
                        cavok: false,
                    }, { liftClouds: false });
                    return;
                }
                if (!beforeTempo) {
                    return;
                }
                // Lead-in: soften SCT/BKN → FEW at a higher base (descending deck into TEMPO).
                const sctFt = meanScatteredBaseFt(mean.state);
                const bknFt = meanSignificantCloudBaseFt(mean.state);
                const leadBase = Number.isFinite(bknFt) ? bknFt : sctFt;
                if (!Number.isFinite(leadBase)) {
                    return;
                }
                const fewBase = Math.max(leadBase, tempoBase + 500, 2000);
                mean.state = normalizeMeanState({
                    ...mean.state,
                    weather: mean.state.weather || [],
                    clouds: [{ amount: 'FEW', baseFt: snapCloudBaseFt(fewBase) }],
                    cavok: false,
                }, { liftClouds: false });
            });
        });

        return groups;
    }

    /**
     * Align CAVOK means with coincident precip/fog TEMPOs (SCT at TEMPO base).
     * Dry low-cloud TEMPOs are handled by refineDryLowCloudMeanTempoStory.
     */
    function alignCavokMeanWithCloudTempos(groups) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const means = groups.filter(isMeanChangeGroup).slice().sort(byStart);
        const tempos = groups.filter((group) => (
            group.kind === 'TEMPO'
            && Number.isFinite(lowCeilingCloud(group.state)?.baseFt)
            && !isDryLowCloudTempo(group)
        ));
        if (!means.length || !tempos.length) {
            return groups;
        }
        means.forEach((mean, index) => {
            if (meanSignificantCloudBaseFt(mean.state) || meanScatteredBaseFt(mean.state)) {
                return;
            }
            const { start, end } = meanActiveWindow(means, index);
            let tempoFt = null;
            tempos.forEach((tempo) => {
                if (!rangesOverlap(start, end, tempo.startMs, tempo.endExclusiveMs)) {
                    return;
                }
                if (holdingHasPrecipStorm(tempo.state) && meanWxKey(mean.state)) {
                    return;
                }
                const baseFt = lowCeilingCloud(tempo.state)?.baseFt;
                if (!Number.isFinite(baseFt)) {
                    return;
                }
                tempoFt = tempoFt == null ? baseFt : Math.min(tempoFt, baseFt);
            });
            if (!Number.isFinite(tempoFt)) {
                return;
            }
            mean.state = normalizeMeanState({
                ...mean.state,
                weather: mean.state.weather || [],
                clouds: [{ amount: 'SCT', baseFt: tempoFt }],
                cavok: false,
            }, { liftClouds: false });
        });
        return groups;
    }

    /** Drop consecutive identical CAVOK means (e.g. two BECMG CAVOK in a row). */
    function collapseRedundantCavokMeans(groups) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const sorted = (groups || []).slice().sort(byStart);
        const out = [];
        sorted.forEach((group) => {
            const prev = out[out.length - 1];
            if (
                prev
                && isMeanChangeGroup(prev)
                && isMeanChangeGroup(group)
                && prev.state?.cavok
                && group.state?.cavok
                && angularDiff(prev.state.windDir, group.state.windDir) < (THRESHOLDS.meanOptionalDirDeg || 60)
                && Math.abs(publishedWindKt(prev.state) - publishedWindKt(group.state))
                    < (THRESHOLDS.windChangeKt || 10)
            ) {
                // Keep the earlier CAVOK; absorb later duplicate.
                prev.state = blendMeanWindStates(prev.state, group.state);
                prev.requireNsw = Boolean(prev.requireNsw || group.requireNsw);
                return;
            }
            out.push(group);
        });
        return out;
    }

    /**
     * Drop FM/BECMG that do not meaningfully change the active mean (including the
     * header). Catches tiny CAVOK wind pickups like 25021KT → BECMG 25024KT.
     */
    function pruneInsignificantMeanGroups(groups, headerBase) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const sorted = (groups || []).slice().sort(byStart);
        const out = [];
        let active = headerBase;
        sorted.forEach((group) => {
            if (!isMeanChangeGroup(group)) {
                out.push(group);
                return;
            }
            // Holding onset / transition / cessation are definitive regime edges —
            // never drop as "insignificant" (line pressure does not remove these either).
            if (
                group.meanSource === 'holding-onset'
                || group.meanSource === 'holding-transition'
                || group.meanSource === 'holding-cessation'
            ) {
                const held = {
                    ...group,
                    state: normalizeMeanState(group.state, { liftClouds: false }),
                };
                out.push(held);
                active = held.state;
                return;
            }
            const state = normalizeMeanState(group.state, { liftClouds: false });
            const change = classifyMeanChange(active, state);
            const sameBody = meanBodyKey(active) === meanBodyKey(state);
            const windDelta = Math.abs(publishedWindKt(active) - publishedWindKt(state));
            const dirDelta = angularDiff(active.windDir, state.windDir);
            const trivialWind = sameBody
                && windDelta < (THRESHOLDS.windChangeKt || 10)
                && dirDelta < (THRESHOLDS.meanOptionalDirDeg || 60);
            if (!change || trivialWind) {
                return;
            }
            const next = { ...group, state };
            out.push(next);
            // BECMG applies from the end of its window; FM from start.
            active = state;
        });
        return out;
    }

    /** Elevated moist deck above fog/stratus (≥1500 ft) for mean SCT under BR/FG. */
    function elevatedDeckFtFromState(state, minFt = 1500) {
        if (!state) {
            return null;
        }
        const candidates = [
            state.elevatedCloudBaseFt,
            state.omCloudBaseFt,
            state.profileCloudBaseFt,
        ];
        let best = null;
        candidates.forEach((ft) => {
            if (!Number.isFinite(ft) || ft < minFt) {
                return;
            }
            best = best == null ? ft : Math.max(best, ft);
        });
        return Number.isFinite(best) ? snapCloudBaseFt(best) : null;
    }

    /**
     * Fog/BR PROB owns very low cloud. Strip overlapping mean BKN/SCT/FEW ≤1000
     * (incl. parked BKN006 / invented SCT010) so the mean does not republish the
     * PROB ceiling. Re-seed elevated SCT (≥1500) when the profile supports it.
     */
    function stripMeanBknUnderFogHoldings(groups) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const means = groups.filter(isMeanChangeGroup).slice().sort(byStart);
        const fogHoldings = groups.filter((group) => (
            (group.kind === 'PROB30' || group.kind === 'PROB40' || group.kind === 'TEMPO')
            && (hourHasFog(group.state) || fogPolicyCategory(group.state) >= 1)
        ));
        if (!means.length) {
            return groups;
        }
        means.forEach((mean, index) => {
            const { start, end } = meanActiveWindow(means, index);
            const fogOverlap = fogHoldings.some((holding) => rangesOverlap(
                start,
                end,
                holding.startMs,
                holding.endExclusiveMs,
            ));
            const shallow = meanHasShallowMoistDeck(mean.state);
            if (!fogOverlap && !shallow) {
                return;
            }
            let clouds = (mean.state?.clouds || []).filter((cloud) => {
                if (cloud.convective === 'CB') {
                    return true;
                }
                if (
                    ['BKN', 'OVC', 'SCT', 'FEW'].includes(cloud.amount)
                    && Number.isFinite(cloud.baseFt)
                    && cloud.baseFt <= 1000
                ) {
                    return false;
                }
                return true;
            });
            const elevatedFt = elevatedDeckFtFromState(mean.state);
            const hasElevated = clouds.some((cloud) => (
                cloud.convective !== 'CB'
                && Number.isFinite(cloud.baseFt)
                && cloud.baseFt >= 1500
            ));
            const seededElevated = fogOverlap && Number.isFinite(elevatedFt) && !hasElevated;
            if (seededElevated) {
                clouds = [...clouds, { amount: 'SCT', baseFt: elevatedFt }];
            }
            if (clouds.length === (mean.state?.clouds || []).length && !seededElevated) {
                return;
            }
            mean.state = normalizeMeanState({
                ...mean.state,
                weather: mean.state.weather || [],
                clouds,
            }, { liftClouds: false });
        });
        return groups;
    }

    /**
     * Non-fog dry/DZ TEMPOs must not sit at fog depths (BKN003–005) from a bad
     * surface LCL. Floor at 1000 ft unless a fog/BR PROB owns that layer.
     */
    function sanitizeDryTempoCloudFloor(tempoGroups, minFt = 1000) {
        (tempoGroups || []).forEach((group) => {
            if (group.kind !== 'TEMPO') {
                return;
            }
            if (holdingHasPrecipStorm(group.state) || hourHasFog(group.state)) {
                return;
            }
            const baseFt = lowCeilingCloud(group.state)?.baseFt;
            if (!Number.isFinite(baseFt) || baseFt >= minFt) {
                return;
            }
            const raised = THRESHOLDS.tempoCloudBasesFt.find((band) => band >= minFt)
                || minFt;
            group.state = temperHoldingClouds(setLowCeilingCloud(group.state, raised));
        });
        return tempoGroups;
    }

    /**
     * Adjacent precip TEMPOs step ceilings with severity: heavier sits lower.
     * Covers SHRA→RA (lower the earlier SHRA) and RA→SHRA (lower the later SHRA),
     * e.g. 5000 RA OVC005 then 4000 SHRA OVC003.
     */
    function enforcePrecipTempoCloudSteps(tempoGroups) {
        const sorted = (tempoGroups || [])
            .filter((group) => group.kind === 'TEMPO' && tempoHasPrecip(group.state))
            .slice()
            .sort((a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey);
        const severity = (group) => {
            const code = primaryPrecipCode(group.state);
            const visM = Number.isFinite(group.state?.visM) ? group.state.visM : 9999;
            let score = 0;
            if (code === 'SHRA') score += 3;
            else if (code === 'SN') score += 2;
            else if (code === 'RA') score += 1;
            if (visM <= 2000) score += 3;
            else if (visM <= 4000) score += 2;
            else if (visM <= 6000) score += 1;
            return score;
        };
        const stepHeavierBelow = (heavier, reference) => {
            const refBase = lowCeilingCloud(reference.state)?.baseFt;
            if (!Number.isFinite(refBase)) {
                return;
            }
            let target = nextLowerTempoBand(refBase);
            if (refBase >= 1500) {
                target = Math.min(target, 1200);
            }
            const existing = lowCeilingCloud(heavier.state)?.baseFt;
            if (Number.isFinite(existing) && existing < refBase && existing <= target) {
                return;
            }
            heavier.state = setLowCeilingCloud(heavier.state, snapTempoBandAtOrBelow(target));
        };
        for (let index = 0; index < sorted.length - 1; index += 1) {
            const earlier = sorted[index];
            const later = sorted[index + 1];
            const gap = gapHoursBetween(earlier.endExclusiveMs, later.startMs);
            // Only step adjacent / slightly overlapping precip spells.
            if (gap > 1) {
                continue;
            }
            const sevEarlier = severity(earlier);
            const sevLater = severity(later);
            if (sevLater > sevEarlier) {
                // RA → SHRA: lower the later heavier TEMPO.
                stepHeavierBelow(later, earlier);
            } else if (sevEarlier > sevLater) {
                // SHRA → RA: lower the earlier heavier TEMPO.
                stepHeavierBelow(earlier, later);
            }
        }
        return tempoGroups;
    }

    function mergeMeanGroupsByTime(groups) {
        const byStart = (a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey;
        const sorted = (groups || []).slice().sort(byStart);
        const out = [];
        sorted.forEach((group) => {
            const prev = out[out.length - 1];
            if (prev && prev.startMs === group.startMs && isMeanChangeGroup(prev) && isMeanChangeGroup(group)) {
                // Same instant: prefer holding-driven wx body over pure wind mean.
                if (isHoldingDrivenMean(group) && !isHoldingDrivenMean(prev)) {
                    out[out.length - 1] = {
                        ...group,
                        state: {
                            ...group.state,
                            windKt: group.state.windKt ?? prev.state.windKt,
                            windDir: group.state.windDir ?? prev.state.windDir,
                            gustKt: group.state.gustKt ?? prev.state.gustKt,
                            windGroup: group.state.windGroup || prev.state.windGroup,
                        },
                    };
                    return;
                }
                if (isHoldingDrivenMean(prev) && !isHoldingDrivenMean(group)) {
                    prev.state = {
                        ...prev.state,
                        windKt: group.state?.windKt ?? prev.state.windKt,
                        windDir: group.state?.windDir ?? prev.state.windDir,
                        gustKt: group.state?.gustKt ?? prev.state.gustKt,
                        windGroup: prev.state.windGroup || group.state?.windGroup,
                    };
                    return;
                }
            }
            out.push(group);
        });
        return out;
    }

    /**
     * During a precip_storm TEMPO spell, holding FM lines own the story.
     * Drop wind-segmenter FM/BECMG that start inside or run into that window.
     * Do not truncate BECMG to abut the holding FM (BECMG …/0721 + FM072100).
     */
    function pruneWindMeansDuringPrecipSpell(means, tempoGroups) {
        const precipTempos = (tempoGroups || []).filter((group) => (
            group.kind === 'TEMPO' && isPrecipStormCode(primaryPrecipCode(group.state))
        ));
        if (!precipTempos.length || !means?.length) {
            return means || [];
        }
        const hasHoldingStory = means.some((group) => (
            isHoldingDrivenMean(group)
            && (group.meanSource === 'holding-onset'
                || group.meanSource === 'holding-transition'
                || group.meanSource === 'holding-cessation')
        ));
        if (!hasHoldingStory) {
            return means;
        }
        const hourMs = 60 * 60 * 1000;
        const inPrecipSpell = (ms) => precipTempos.some((tempo) => (
            ms >= tempo.startMs && ms < tempo.endExclusiveMs
        ));
        const out = [];
        means.forEach((group) => {
            if (!isMeanChangeGroup(group) || isHoldingDrivenMean(group)) {
                out.push(group);
                return;
            }
            if (group.kind === 'BECMG') {
                // Per-spell windows (not min→max span) so gaps between showers keep means.
                const blocking = precipTempos.find((tempo) => (
                    group.startMs < tempo.endExclusiveMs
                    && group.endExclusiveMs > tempo.startMs - hourMs
                ));
                if (!blocking) {
                    out.push(group);
                    return;
                }
                if (group.startMs < blocking.startMs - hourMs) {
                    const truncatedEnd = blocking.startMs - hourMs;
                    const durH = (truncatedEnd - group.startMs) / hourMs;
                    if (durH >= 1) {
                        out.push({ ...group, endExclusiveMs: truncatedEnd });
                    }
                }
                return;
            }
            // Wind FM: keep only outside every precip TEMPO interval.
            if (!inPrecipSpell(group.startMs)) {
                out.push(group);
            }
        });
        return out;
    }

    /**
     * FM must never start inside or at the end of a BECMG window (no overlap, no
     * abut). End BECMG ≥1 h before the FM, or drop it. Holding FM wins.
     */
    function resolveBecmgFmOverlaps(means) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        const list = (means || []).slice().sort(byStart);
        if (list.length < 2) {
            return list;
        }
        const hourMs = 60 * 60 * 1000;
        const fms = list.filter((group) => group.kind === 'FM');
        const out = [];
        list.forEach((group) => {
            if (group.kind !== 'BECMG') {
                out.push(group);
                return;
            }
            // Conflict: FM starts during BECMG, or exactly when BECMG ends (abut).
            const fmConflict = fms
                .filter((fm) => (
                    fm.startMs > group.startMs
                    && fm.startMs <= group.endExclusiveMs
                ))
                .sort(byStart)[0];
            if (!fmConflict) {
                out.push(group);
                return;
            }
            const truncatedEnd = fmConflict.startMs - hourMs;
            const durH = (truncatedEnd - group.startMs) / hourMs;
            if (durH >= 1) {
                out.push({
                    ...group,
                    endExclusiveMs: truncatedEnd,
                    sortKey: group.startMs,
                });
            }
            // else drop — cannot keep BECMG without abutting/overlapping the FM.
        });
        return out.sort(byStart);
    }

    /**
     * Segment published mean hours into regimes and emit FM/BECMG change groups.
     * First segment is the header mean (no line); later segments become mean lines.
     */
    function buildMeanChangeGroups(publishedHours) {
        if (!publishedHours?.length) {
            return [];
        }
        const means = publishedHours.map((hour) => normalizeMeanState(hour, { liftClouds: false }));
        const minHours = Math.max(1, THRESHOLDS.meanChangeMinHours || 2);
        const breaks = [];
        let segRep = means[0];
        let segStart = 0;
        for (let index = 1; index < means.length; index += 1) {
            const changeKind = classifyMeanChange(segRep, means[index]);
            if (!changeKind) {
                continue;
            }
            // Require the new regime to hold for meanChangeMinHours (or to end).
            const lookEnd = Math.min(means.length - 1, index + minHours - 1);
            let held = 0;
            for (let look = index; look <= lookEnd; look += 1) {
                if (classifyMeanChange(segRep, means[look])) {
                    held += 1;
                }
            }
            const remaining = means.length - index;
            if (held < minHours && remaining >= minHours) {
                continue;
            }
            // Prefer comparing against the new hour's own continuity.
            const newRep = means[index];
            let stableNew = 1;
            for (let look = index + 1; look < means.length && look < index + minHours; look += 1) {
                if (!classifyMeanChange(newRep, means[look])) {
                    stableNew += 1;
                } else {
                    break;
                }
            }
            if (stableNew < minHours && remaining >= minHours) {
                continue;
            }
            breaks.push({
                index,
                priority: changeKind,
                gradual: isGradualMeanTransition(means, index),
            });
            segRep = means[index];
            segStart = index;
        }
        void segStart;

        if (!breaks.length) {
            return [];
        }

        const boundaries = [0, ...breaks.map((entry) => entry.index), means.length];
        const groups = [];
        for (let breakPos = 0; breakPos < breaks.length; breakPos += 1) {
            const brk = breaks[breakPos];
            const prevStart = boundaries[breakPos];
            const prevEnd = boundaries[breakPos + 1] - 1;
            const nextStart = boundaries[breakPos + 1];
            const nextEnd = boundaries[breakPos + 2] - 1;
            const prevState = meanSegmentRepresentative(means, prevStart, prevEnd);
            const nextState = meanSegmentRepresentative(means, nextStart, nextEnd);
            const requireNsw = Boolean(meanWxKey(prevState)) && !meanWxKey(nextState) && !nextState.cavok;
            const changeAt = publishedHours[brk.index].validTime;
            const changeMs = changeAt.getTime();
            const tafStartMs = publishedHours[0].validTime.getTime();
            const becmgHours = Math.max(1, Math.min(2, THRESHOLDS.becmgHours || 2));
            if (brk.gradual) {
                let startMs = changeMs - ((becmgHours - 1) * 60 * 60 * 1000);
                startMs = Math.max(tafStartMs, startMs);
                let endExclusiveMs = startMs + (becmgHours * 60 * 60 * 1000);
                // Keep window 1–2 h and cover the regime change hour.
                if (endExclusiveMs <= changeMs) {
                    endExclusiveMs = changeMs + (60 * 60 * 1000);
                    startMs = Math.max(tafStartMs, endExclusiveMs - (becmgHours * 60 * 60 * 1000));
                }
                groups.push({
                    kind: 'BECMG',
                    meanPriority: brk.priority,
                    requireNsw,
                    state: nextState,
                    startMs,
                    endExclusiveMs,
                    sortKey: startMs,
                    text: '',
                });
            } else {
                groups.push({
                    kind: 'FM',
                    meanPriority: brk.priority,
                    requireNsw,
                    state: nextState,
                    startMs: changeMs,
                    endExclusiveMs: changeMs,
                    sortKey: changeMs,
                    text: '',
                });
            }
        }
        return collapseSameBodyMeanGroups(groups);
    }

    function pad2(value) {
        return String(Math.max(0, Math.round(Number(value) || 0))).padStart(2, '0');
    }

    function formatDdhh(dateValue) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return '----';
        }
        return `${pad2(dateValue.getUTCDate())}${pad2(dateValue.getUTCHours())}`;
    }

    /**
     * Approximate UTC sunrise/sunset for the UTC calendar day of `date` (NOAA-style).
     * Civil dawn/dusk (90.833°). lon is east-positive. Returns nulls for polar day/night.
     */
    function getSunriseSunsetUtc(lat, lon, date) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !(date instanceof Date)) {
            return { sunrise: null, sunset: null };
        }
        const rad = Math.PI / 180;
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const dayOfYear = Math.floor(
            (Date.UTC(year, month, day) - Date.UTC(year, 0, 0)) / 86400000,
        );
        // Fractional year at 12:00 UTC of this calendar day.
        const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + ((12 - 12) / 24));
        const eqTime = 229.18 * (
            0.000075
            + (0.001868 * Math.cos(gamma))
            - (0.032077 * Math.sin(gamma))
            - (0.014615 * Math.cos(2 * gamma))
            - (0.040849 * Math.sin(2 * gamma))
        );
        const decl = 0.006918
            - (0.399912 * Math.cos(gamma))
            + (0.070257 * Math.sin(gamma))
            - (0.006758 * Math.cos(2 * gamma))
            + (0.000907 * Math.sin(2 * gamma))
            - (0.002697 * Math.cos(3 * gamma))
            + (0.00148 * Math.sin(3 * gamma));
        const latR = lat * rad;
        const cosHa = (Math.cos(90.833 * rad) / (Math.cos(latR) * Math.cos(decl)))
            - (Math.tan(latR) * Math.tan(decl));
        if (cosHa <= -1 || cosHa >= 1) {
            return { sunrise: null, sunset: null };
        }
        const haDeg = Math.acos(cosHa) / rad;
        // Minutes from 00:00 UTC on this calendar day.
        const solarNoonUtcMin = 720 - (4 * lon) - eqTime;
        const sunriseMin = solarNoonUtcMin - (4 * haDeg);
        const sunsetMin = solarNoonUtcMin + (4 * haDeg);
        const baseMs = Date.UTC(year, month, day);
        return {
            sunrise: new Date(baseMs + (sunriseMin * 60000)),
            sunset: new Date(baseMs + (sunsetMin * 60000)),
        };
    }

    function getSunTimesNear(lat, lon, date) {
        const dayMs = 24 * 60 * 60 * 1000;
        const today = getSunriseSunsetUtc(lat, lon, date);
        const yesterday = getSunriseSunsetUtc(lat, lon, new Date(date.getTime() - dayMs));
        const tomorrow = getSunriseSunsetUtc(lat, lon, new Date(date.getTime() + dayMs));
        const sunrises = [yesterday.sunrise, today.sunrise, tomorrow.sunrise]
            .filter(Boolean)
            .map((value) => value.getTime())
            .sort((a, b) => a - b);
        const sunsets = [yesterday.sunset, today.sunset, tomorrow.sunset]
            .filter(Boolean)
            .map((value) => value.getTime())
            .sort((a, b) => a - b);
        return { sunrises, sunsets };
    }

    /**
     * Diurnal phase for draft bias:
     * night | predawn | morning | afternoon | evening
     */
    function diurnalPhaseAt(lat, lon, validTime) {
        if (!(validTime instanceof Date) || !Number.isFinite(lat) || !Number.isFinite(lon)) {
            return 'morning';
        }
        const { sunrises, sunsets } = getSunTimesNear(lat, lon, validTime);
        if (!sunrises.length || !sunsets.length) {
            // Polar / missing: treat as overnight-conservative.
            return 'night';
        }
        const t = validTime.getTime();
        const prevSunrise = [...sunrises].reverse().find((ms) => ms <= t);
        const nextSunrise = sunrises.find((ms) => ms > t);
        const prevSunset = [...sunsets].reverse().find((ms) => ms <= t);
        const nextSunset = sunsets.find((ms) => ms > t);
        const predawnMs = (THRESHOLDS.predawnHoursBeforeSunrise || 3) * 3600000;
        const eveningMs = (THRESHOLDS.eveningHoursBeforeSunset || 2) * 3600000;

        // Daytime if the most recent solar event was sunrise (not sunset).
        const inDaylight = Number.isFinite(prevSunrise)
            && (!Number.isFinite(prevSunset) || prevSunrise > prevSunset)
            && Number.isFinite(nextSunset);

        if (inDaylight) {
            const sunrise = prevSunrise;
            const sunset = nextSunset;
            const dayLen = Math.max(3600000, sunset - sunrise);
            const afternoonStart = sunrise + (0.45 * dayLen);
            if (t < afternoonStart) {
                return 'morning';
            }
            if (t < (sunset - eveningMs)) {
                return 'afternoon';
            }
            return 'evening';
        }

        if (Number.isFinite(nextSunrise) && t >= (nextSunrise - predawnMs) && t < nextSunrise) {
            return 'predawn';
        }
        return 'night';
    }

    function isOvernightPhase(phase) {
        return phase === 'night' || phase === 'predawn';
    }

    function isOptimisticCloudPhase(phase) {
        return phase === 'afternoon' || phase === 'evening';
    }

    function holdingIsDryLowCloud(state) {
        const wx = state?.weather || [];
        // Precip/fog/TS are not "fleeting dry cloud"; DZ alone may still be waved off.
        if (wx.some((code) => ['TSRA', 'FG', 'FZFG', 'BR', 'SHRA', 'RA', 'SN'].includes(code))) {
            return false;
        }
        return (state?.clouds || []).some((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC')
            && cloud.convective !== 'CB'
        ));
    }

    function hasDefinitiveRegimeChange(beforeState, gapHours) {
        if (!gapHours?.length || !beforeState) {
            return false;
        }
        if (gapHours.some(hourHasTs)) {
            return true;
        }
        const endState = gapHours[gapHours.length - 1];
        const windJump = (endState.windKt || 0) - (beforeState.windKt || 0);
        if (windJump >= 10) {
            return true;
        }
        if (
            angularDiff(beforeState.windDir, endState.windDir) >= 60
            && Math.max(beforeState.windKt || 0, endState.windKt || 0) >= 8
        ) {
            return true;
        }
        const beforePrecip = (beforeState.weather || []).some((code) => (
            code === 'RA' || code === 'SHRA' || code === 'TSRA' || code === 'SN'
        ));
        const afterPrecip = (endState.weather || []).some((code) => (
            code === 'RA' || code === 'SHRA' || code === 'TSRA' || code === 'SN'
        ));
        return afterPrecip && !beforePrecip;
    }

    function nextSunriseAfter(lat, lon, ms) {
        const { sunrises } = getSunTimesNear(lat, lon, new Date(ms));
        const next = sunrises.find((value) => value > ms);
        return Number.isFinite(next) ? next : null;
    }

    function gapIsOvernight(lat, lon, startExclusiveMs, endMs) {
        if (!Number.isFinite(startExclusiveMs) || !Number.isFinite(endMs) || endMs <= startExclusiveMs) {
            return false;
        }
        const mid = new Date((startExclusiveMs + endMs) / 2);
        return isOvernightPhase(diurnalPhaseAt(lat, lon, mid));
    }

    /**
     * TAF period end is exclusive (e.g. one hour at 04Z → 0804/0805).
     * Never extends past the TAF validity end.
     * Returns null when the period would be empty / beyond validity.
     */
    function formatPeriod(startDate, endDateInclusive, validityEnd) {
        if (!(startDate instanceof Date) || !(endDateInclusive instanceof Date)) {
            return null;
        }
        let endExclusive = new Date(endDateInclusive.getTime() + 60 * 60 * 1000);
        if (validityEnd instanceof Date && !Number.isNaN(validityEnd.getTime())) {
            if (startDate.getTime() >= validityEnd.getTime()) {
                return null;
            }
            if (endExclusive.getTime() > validityEnd.getTime()) {
                endExclusive = new Date(validityEnd.getTime());
            }
        }
        if (endExclusive.getTime() <= startDate.getTime()) {
            return null;
        }
        return {
            text: `${formatDdhh(startDate)}/${formatDdhh(endExclusive)}`,
            startMs: startDate.getTime(),
            endExclusiveMs: endExclusive.getTime(),
        };
    }

    function hourHasTs(hour) {
        return (hour?.weather || []).includes('TSRA');
    }

    function hourHasFog(hour) {
        return (hour?.weather || []).some((code) => code === 'FG' || code === 'FZFG' || code === 'BR');
    }

    function sliceHasFog(slice) {
        return (slice || []).some(hourHasFog);
    }

    function sliceHasVisReduction(slice) {
        return (slice || []).some((hour) => (
            hourHasFog(hour)
            || (Number.isFinite(hour?.visM) && hour.visM <= THRESHOLDS.mistVisMaxM)
        ));
    }

    function cloudSignificance(cloud) {
        if (!cloud) {
            return Number.POSITIVE_INFINITY;
        }
        const amountRank = { OVC: 0, BKN: 1, SCT: 2, FEW: 3 };
        const rank = amountRank[cloud.amount] ?? 9;
        const base = Number.isFinite(cloud.baseFt) ? cloud.baseFt : 9999;
        return rank * 100000 + base;
    }

    function pickMoreSignificantClouds(aClouds, bClouds) {
        const a = (aClouds || [])[0];
        const b = (bClouds || [])[0];
        if (!a) return bClouds || [];
        if (!b) return aClouds || [];
        return cloudSignificance(a) <= cloudSignificance(b) ? aClouds : bClouds;
    }

    function mergeTempoStates(a, b) {
        if (!a) return b;
        if (!b) return a;
        const weather = dedupeWeatherCodes([
            ...(a.weather || []),
            ...(b.weather || []),
        ]).slice(0, 3);
        const clouds = pickMoreSignificantClouds(a.clouds, b.clouds);
        const visM = Math.min(
            Number.isFinite(a.visM) ? a.visM : 9999,
            Number.isFinite(b.visM) ? b.visM : 9999,
        );
        const windSource = (Number.isFinite(b.windKt) && (!Number.isFinite(a.windKt) || b.windKt >= a.windKt))
            ? b
            : a;
        const windKt = Math.max(
            Number.isFinite(a.windKt) ? a.windKt : 0,
            Number.isFinite(b.windKt) ? b.windKt : 0,
        );
        const gustKt = Math.max(
            Number.isFinite(a.gustKt) ? a.gustKt : 0,
            Number.isFinite(b.gustKt) ? b.gustKt : 0,
        );
        const peaked = {
            ...windSource,
            windKt: windKt > 0 ? windKt : windSource.windKt,
            gustKt: gustKt > 0 ? gustKt : windSource.gustKt,
        };
        return {
            ...peaked,
            weather,
            clouds,
            visM,
            cavok: false,
            windGroup: formatWindGroup(peaked.windKt, peaked.windDir, peaked.gustKt),
        };
    }

    function holdingClass(state) {
        const wx = state?.weather || [];
        if (wx.includes('TSRA')) return 'storm';
        if (wx.some((code) => code === 'FG' || code === 'FZFG' || code === 'BR')) return 'fog';
        if (wx.some((code) => code === 'RA' || code === 'SHRA' || code === 'DZ' || code === 'SN')) {
            return 'precip';
        }
        return 'cloud';
    }

    function cloudBandDiff(a, b) {
        const bandA = tempoCloudBand(a?.state);
        const bandB = tempoCloudBand(b?.state);
        if (bandA === Number.POSITIVE_INFINITY && bandB === Number.POSITIVE_INFINITY) {
            return 0;
        }
        if (bandA === Number.POSITIVE_INFINITY || bandB === Number.POSITIVE_INFINITY) {
            return 1;
        }
        const bases = THRESHOLDS.tempoCloudBasesFt;
        const ia = bases.indexOf(bandA);
        const ib = bases.indexOf(bandB);
        if (ia < 0 || ib < 0) {
            return 99;
        }
        return Math.abs(ia - ib);
    }

    function primaryPrecipCode(state) {
        const wx = state?.weather || [];
        if (wx.includes('SHRA')) {
            return 'SHRA';
        }
        if (wx.includes('RA')) {
            return 'RA';
        }
        if (wx.includes('DZ')) {
            return 'DZ';
        }
        if (wx.includes('SN')) {
            return 'SN';
        }
        return null;
    }

    function similarHoldings(a, b, { maxBandDiff = 1 } = {}) {
        if (!a?.state || !b?.state) {
            return false;
        }
        const classA = holdingClass(a.state);
        const classB = holdingClass(b.state);
        if (classA === 'storm' || classB === 'storm') {
            return classA === classB;
        }
        if (classA === 'fog' || classB === 'fog') {
            return classA === classB;
        }
        // Precip and low-cloud holdings are treated as the same intermittent regime.
        if (!((classA === 'precip' || classA === 'cloud')
            && (classB === 'precip' || classB === 'cloud'))) {
            return false;
        }
        // Keep storm-coincident SHRA distinct from background RA/DZ after a split.
        if (classA === 'precip' && classB === 'precip') {
            const precipA = primaryPrecipCode(a.state);
            const precipB = primaryPrecipCode(b.state);
            if (precipA && precipB && precipA !== precipB) {
                return false;
            }
        }
        return cloudBandDiff(a, b) <= maxBandDiff;
    }

    /**
     * Validity-scaled line budget. Longer TAFs get a higher soft target and a
     * slower resistance ramp; short TAFs stay tight.
     */
    function validityLineBudget(validityHours) {
        const ref = THRESHOLDS.tafResistanceRefHours;
        const hours = Math.max(6, Number(validityHours) || ref);
        // sqrt so 48 h ≈ 1.41× budget, 12 h ≈ 0.71× (not a full double/half).
        const scale = Math.sqrt(hours / ref);
        const soft = Math.max(3, Math.round(THRESHOLDS.tafSoftLineTarget * scale));
        const cap = Math.max(soft + 3, Math.round(THRESHOLDS.tafLineSoftCap * scale));
        return { soft, cap, scale, hours };
    }

    /** Resistance grows past the validity-scaled soft target, steeper near/above cap. */
    function tafLineResistance(lineCount, validityHours) {
        const { soft, cap, scale } = validityLineBudget(validityHours);
        if (lineCount <= soft) {
            return 0;
        }
        // Longer validities damp the ramp (divide gentle/steep slopes by scale).
        const gentle = 0.22 / Math.max(0.75, scale);
        const steep = 0.28 / Math.max(0.75, scale);
        if (lineCount <= soft + 3) {
            return (lineCount - soft) * gentle;
        }
        if (lineCount <= cap) {
            return (3 * gentle) + (lineCount - (soft + 3)) * steep;
        }
        return Math.min(2.5, (3 * gentle) + ((cap - soft - 3) * steep) + (lineCount - cap) * 0.35);
    }

    function bridgeGapLimit(resistance) {
        return Math.min(
            6,
            THRESHOLDS.tempoBridgeMaxGapHours + Math.floor(resistance * 3),
        );
    }

    function maxBandDiffForMerge(resistance, gapHours) {
        if (gapHours <= THRESHOLDS.tempoRiskyGapHours) {
            return 1; // always allow adjacent bands across a 1h hole
        }
        if (resistance >= 1) {
            return 2;
        }
        if (resistance >= 0.4) {
            return 1;
        }
        return 1;
    }

    /**
     * Operational wind-speed ladder: 2–6 by 1, then even / 3–5 kt steps to 50;
     * above 50 kt round to the nearest 5.
     */
    function roundWindKt(kt) {
        if (!Number.isFinite(kt) || kt < 0) {
            return 0;
        }
        if (kt === 0) {
            return 0;
        }
        if (kt > 50) {
            return Math.min(99, Math.round(kt / 5) * 5);
        }
        const ladder = THRESHOLDS.windSpeedLadderKt || [
            2, 3, 4, 5, 6, 8, 10, 12, 14, 15, 16, 18, 20, 22, 25, 28, 30,
            32, 35, 38, 40, 42, 45, 48, 50,
        ];
        let best = ladder[0];
        let bestDist = Math.abs(kt - best);
        ladder.forEach((step) => {
            const dist = Math.abs(kt - step);
            // Tie → higher step (e.g. 21 → 22, 23.5 → 25).
            if (dist < bestDist || (dist === bestDist && step > best)) {
                best = step;
                bestDist = dist;
            }
        });
        return best;
    }

    function publishedWindKt(stateOrKt) {
        const raw = Number.isFinite(stateOrKt) ? stateOrKt : stateOrKt?.windKt;
        if (!Number.isFinite(raw)) {
            return 0;
        }
        return Math.max(THRESHOLDS.windMinKt || 2, roundWindKt(raw));
    }

    /** Round wind/gust to a fixed step (default 5 kt) for storm PROB groups. */
    function roundWindKtToStep(kt, step = 5) {
        if (!Number.isFinite(kt) || kt < 0) {
            return 0;
        }
        const size = step > 0 ? step : 5;
        return Math.min(99, Math.round(kt / size) * size);
    }

    /**
     * Peak mean wind + gust over a storm PROB slice (not the single worst-wx hour).
     * Direction follows the hour that supplied the peak mean wind.
     */
    function peakWindHourFromSlice(slice, fallback) {
        const hours = (slice && slice.length) ? slice : (fallback ? [fallback] : []);
        let windKt = null;
        let gustKt = null;
        let windDir = Number.isFinite(fallback?.windDir) ? fallback.windDir : null;
        hours.forEach((hour) => {
            if (Number.isFinite(hour?.windKt) && (windKt == null || hour.windKt > windKt)) {
                windKt = hour.windKt;
                if (Number.isFinite(hour.windDir)) {
                    windDir = hour.windDir;
                }
            }
            if (Number.isFinite(hour?.gustKt) && (gustKt == null || hour.gustKt > gustKt)) {
                gustKt = hour.gustKt;
            }
        });
        return {
            ...(fallback || {}),
            windKt: windKt ?? fallback?.windKt ?? null,
            gustKt: gustKt ?? fallback?.gustKt ?? null,
            windDir,
        };
    }

    function roundWindDir(deg, speedKt) {
        if (!Number.isFinite(deg) || speedKt < 1) {
            return 0;
        }
        let dir = Math.round(deg / 10) * 10;
        if (dir === 0) {
            dir = 360;
        }
        if (dir > 360) {
            dir = 360;
        }
        return dir;
    }

    function formatWindGroup(speedKt, dirDeg, gustKt) {
        const minKt = THRESHOLDS.windMinKt || 2;
        const vrbMaxKt = THRESHOLDS.windVrbMaxKt || 4;
        // Operational floor: never 00000KT — minimum VRB02KT.
        const spd = Math.max(minKt, roundWindKt(speedKt));
        // VRB only for light winds (≤4 kt); above that use a direction group.
        let ddd;
        if (spd <= vrbMaxKt) {
            ddd = 'VRB';
        } else if (Number.isFinite(dirDeg)) {
            ddd = String(roundWindDir(dirDeg, spd)).padStart(3, '0');
        } else {
            ddd = '360';
        }
        const gustVal = roundWindKt(gustKt);
        // Operational floor: mean ≥15 kt, gust ≥25 kt, and ≥gustExcess above mean (15G25 min).
        const showGust = Number.isFinite(gustKt)
            && spd >= (THRESHOLDS.gustMeanMinKt || 15)
            && gustVal >= (THRESHOLDS.gustMinKt || 25)
            && gustVal >= spd + (THRESHOLDS.gustExcessKt || 10);
        const gust = showGust ? `G${pad2(gustVal)}` : '';
        return `${ddd}${pad2(spd)}${gust}KT`;
    }

    /**
     * Thunderstorm PROB wind: always VRB, always gusted, floor 15G25.
     * When refMean is supplied, speed and gust must clear the active mean by
     * at least tempoProbWindDeltaKt (operational: storm wind stronger than mean).
     */
    function formatThunderstormProbWind(hour, refMean = null) {
        const minSpd = THRESHOLDS.tempoProbWindMinKt;
        const minGust = THRESHOLDS.tempoProbGustMinKt;
        const step = THRESHOLDS.stormProbWindStepKt || 5;
        const delta = THRESHOLDS.tempoProbWindDeltaKt || 5;
        const rawSpd = Number.isFinite(hour?.windKt) ? hour.windKt : minSpd;
        const rawGust = Number.isFinite(hour?.gustKt) ? hour.gustKt : minGust;
        const meanSpd = Number.isFinite(refMean?.windKt) ? refMean.windKt : 0;
        const meanGust = Number.isFinite(refMean?.gustKt) ? refMean.gustKt : 0;
        let spd = Math.max(
            minSpd,
            roundWindKtToStep(rawSpd, step),
            roundWindKtToStep(meanSpd + delta, step),
        );
        let gust = Math.max(
            minGust,
            roundWindKtToStep(rawGust, step),
            roundWindKtToStep(meanGust + delta, step),
            spd + (THRESHOLDS.gustExcessKt || 10),
        );
        gust = roundWindKtToStep(gust, step);
        if (gust <= spd) {
            gust = roundWindKtToStep(
                Math.max(minGust, spd + (THRESHOLDS.gustExcessKt || 10)),
                step,
            );
            if (gust <= spd) {
                gust = spd + step;
            }
        }
        return `VRB${pad2(spd)}G${pad2(gust)}KT`;
    }

    /** Prevailing mean (header + FM/BECMG) in force at a given time. */
    function activeMeanStateAt(headerBase, meanGroups, atMs) {
        let active = headerBase;
        (meanGroups || [])
            .filter(isMeanChangeGroup)
            .slice()
            .sort((a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey)
            .forEach((group) => {
                // FM applies from startMs; BECMG applies from end of its window.
                const effectiveMs = group.kind === 'BECMG'
                    ? (group.endExclusiveMs || group.startMs)
                    : group.startMs;
                if (effectiveMs <= atMs) {
                    active = group.state || active;
                }
            });
        return active;
    }

    function cloudAmountFromRh(rh) {
        if (!Number.isFinite(rh)) {
            return null;
        }
        if (rh >= THRESHOLDS.ovcRh) return 'OVC';
        if (rh >= THRESHOLDS.bknRh) return 'BKN';
        if (rh >= THRESHOLDS.sctRh) return 'SCT';
        if (rh >= THRESHOLDS.fewRh) return 'FEW';
        return null;
    }

    function snapCloudBaseFt(baseFt) {
        if (!Number.isFinite(baseFt)) {
            return 2000;
        }
        // Forecast cloud bases are reported in 500 ft increments only.
        // Never snap to 000 — surface/fog bases belong on PROB as 001/002.
        return Math.max(200, Math.round(baseFt / 500) * 500);
    }

    function cloudBaseHundredsFt(baseFt) {
        if (!Number.isFinite(baseFt)) {
            return 20;
        }
        // Keep explicit TEMPO / fog-PROB / mean-bracket heights; otherwise 500 ft steps.
        // CB bases may be above 5000 ft AGL and are still reported with a height.
        const fogBases = Object.values(THRESHOLDS.fogProbCloudFt || {});
        const stormProbBases = THRESHOLDS.stormProbCloudBasesFt || [];
        const meanBases = (THRESHOLDS.meanCloudBracketFt || []).map((band) => band.meanFt);
        const onDiscreteBand = THRESHOLDS.tempoCloudBasesFt.includes(baseFt)
            || fogBases.includes(baseFt)
            || stormProbBases.includes(baseFt)
            || meanBases.includes(baseFt);
        const snapped = onDiscreteBand ? baseFt : snapCloudBaseFt(baseFt);
        const hundreds = Math.round(snapped / 100);
        return Math.min(999, Math.max(0, hundreds));
    }

    function formatCloudGroup(amount, baseFt, convective = null) {
        if (!amount) {
            return null;
        }
        const height = String(cloudBaseHundredsFt(baseFt)).padStart(3, '0');
        const suffix = convective === 'CB' ? 'CB' : '';
        return `${amount}${height}${suffix}`;
    }

    /**
     * TSRA PROB lines always carry a CB group with a base (even if >5000 ft AGL).
     */
    function ensureTsraCbClouds(hour) {
        const clouds = (hour?.clouds || []).map((cloud) => ({ ...cloud }));
        if (clouds.some((cloud) => cloud.convective === 'CB')) {
            return clouds;
        }
        let cbBaseFt = Number.isFinite(hour?.lclFt)
            ? Math.max(1000, hour.lclFt)
            : (Number.isFinite(hour?.omCloudBaseFt) ? hour.omCloudBaseFt : 3000);
        cbBaseFt = snapCloudBaseFt(cbBaseFt);
        const lowBase = clouds
            .map((cloud) => cloud.baseFt)
            .filter((base) => Number.isFinite(base));
        if (lowBase.length) {
            const maxLow = Math.max(...lowBase);
            if (cbBaseFt <= maxLow) {
                cbBaseFt = snapCloudBaseFt(maxLow + 500);
            }
        }
        // Prefer SCT for the CB layer when not already present as BKN/OVC CB.
        clouds.push({ amount: 'SCT', baseFt: cbBaseFt, convective: 'CB' });
        return clouds;
    }

    function weatherWithoutTsra(weather) {
        return (weather || []).filter((code) => code !== 'TSRA');
    }

    function visibilityFromCbBaseFt(cbBaseFt) {
        const bands = THRESHOLDS.visTsCbFt || [];
        for (const band of bands) {
            if (!Number.isFinite(cbBaseFt) || cbBaseFt <= band.maxFt) {
                return band.visM;
            }
        }
        return 4000;
    }

    function cbBaseFtFromClouds(clouds) {
        const cb = (clouds || []).find((cloud) => cloud.convective === 'CB');
        return Number.isFinite(cb?.baseFt) ? cb.baseFt : null;
    }

    function precipAmountMm(hour) {
        return Math.max(
            Number(hour?.precipMm) || 0,
            Number(hour?.omPrecipMm) || 0,
            Number(hour?.snowMm) || 0,
        );
    }

    function omShowerWeather(hour) {
        const code = hour?.omWeatherCode;
        return code === 80 || code === 81 || code === 82 || code === 85 || code === 86;
    }

    function omRainWeather(hour) {
        const code = hour?.omWeatherCode;
        return code === 61 || code === 63 || code === 65 || code === 66 || code === 67;
    }

    /** Convective precip (mm/h): Open-Meteo showers, else Policy thunderstorm precip. */
    function convectivePrecipMm(hour) {
        return Math.max(
            Number(hour?.showersMm) || 0,
            Number(hour?.omShowersMm) || 0,
            Number(hour?.tsMm) || 0,
        );
    }

    /** True when precip/showers clear the rain / convective floor — not bare OM codes. */
    function meaningfulWetPrecip(hour) {
        const minConv = THRESHOLDS.convectivePrecipMinMm || THRESHOLDS.precipRainMm || 0.2;
        return precipAmountMm(hour) >= THRESHOLDS.precipRainMm
            || convectivePrecipMm(hour) >= minConv;
    }

    /**
     * SHRA vs RA from convective precip, not light-vs-heavy rate.
     * Requires showers/precip ≥ convectivePrecipMinMm — OM shower codes alone do not.
     */
    function isShoweryPrecip(hour) {
        const convective = convectivePrecipMm(hour);
        const total = Math.max(precipAmountMm(hour), convective);
        const minConv = THRESHOLDS.convectivePrecipMinMm || THRESHOLDS.precipRainMm || 0.2;
        if (convective >= minConv) {
            return true;
        }
        if (total < THRESHOLDS.precipRainMm) {
            return false;
        }
        if (omShowerWeather(hour)) {
            return true;
        }
        // ICON / models without showers: CAPE+precip assist (not when showers is
        // explicitly zero from the API).
        const showersMissing = !Number.isFinite(hour?.showersMm) && !Number.isFinite(hour?.omShowersMm);
        if (
            showersMissing
            && (hour?.capeJkg || 0) >= (THRESHOLDS.capeShowerMinJkg || 150)
        ) {
            return true;
        }
        return false;
    }

    /** RA/SHRA/SN: visibility from precip amount ladder (mm/h). */
    function visibilityFromPrecipAmount(mm) {
        const ladder = THRESHOLDS.visPrecipAmountM || [];
        for (const band of ladder) {
            if (mm >= band.minMm) {
                return band.visM;
            }
        }
        return 9999;
    }

    /**
     * Cloud / drizzle base AGL.
     * Day: surface LCL (fine for well-mixed BL, topo lift; also a good CCL proxy).
     * Night / predawn: elevated moist-deck from the OM profile — surface T/Td LCL
     * is often too low under a nocturnal inversion.
     */
    function resolveCloudBaseFt(hour) {
        const phase = hour?.diurnalPhase
            || (
                hour?.validTime instanceof Date
                && Number.isFinite(hour?.siteLat)
                && Number.isFinite(hour?.siteLon)
                    ? diurnalPhaseAt(hour.siteLat, hour.siteLon, hour.validTime)
                    : null
            );
        const overnight = isOvernightPhase(phase);
        const profile = Number.isFinite(hour?.profileCloudBaseFt) ? hour.profileCloudBaseFt : null;
        const lcl = Number.isFinite(hour?.lclFt) ? hour.lclFt : null;
        const omBase = Number.isFinite(hour?.omCloudBaseFt) ? hour.omCloudBaseFt : null;
        if (overnight) {
            if (profile != null) {
                return Math.max(0, profile);
            }
            if (omBase != null) {
                return Math.max(0, omBase);
            }
            if (lcl != null) {
                return Math.max(0, lcl);
            }
            return null;
        }
        if (lcl != null) {
            return Math.max(0, lcl);
        }
        if (profile != null) {
            return Math.max(0, profile);
        }
        if (omBase != null) {
            return Math.max(0, omBase);
        }
        return null;
    }

    /** Moist-layer proximity for DZ — same base preference as cloud groups. */
    function drizzleLayerBaseFt(hour) {
        return resolveCloudBaseFt(hour);
    }

    /**
     * True drizzle risk: Policy moist-layer RH at/above drizzleRh.
     * Bare OM drizzle weather codes (51/53/55) alone are not enough — they often
     * fire on trace precip without a real DZ visibility cut.
     */
    function hasDrizzleSignal(hour) {
        return (hour?.drizzleRh || 0) >= THRESHOLDS.drizzleRh;
    }

    /**
     * Drizzle-dominated hour (no TS / rain-rate / shower-code ownership).
     * Matches weatherCodesFromState precedence without needing weather[].
     */
    function hourLooksLikeDrizzle(hour) {
        if ((hour?.tsMm || 0) >= THRESHOLDS.precipTsMm) {
            return false;
        }
        if (omShowerWeather(hour) || omRainWeather(hour) || isShoweryPrecip(hour)) {
            return false;
        }
        if (precipAmountMm(hour) >= THRESHOLDS.precipRainMm) {
            return false;
        }
        return hasDrizzleSignal(hour);
    }

    /**
     * DZ vis from layer depth / proximity to ground.
     * Floor at visDzMinM — never invent FG-range vis from drizzle alone.
     */
    function visibilityFromDrizzle(hour) {
        if (!hasDrizzleSignal(hour)) {
            return 9999;
        }
        const baseFt = drizzleLayerBaseFt(hour);
        const bands = THRESHOLDS.visDzByBaseFt || [];
        let visM = 9999;
        if (Number.isFinite(baseFt)) {
            const match = bands.find((band) => baseFt <= band.maxFt);
            visM = match ? match.visM : 9999;
        } else {
            visM = THRESHOLDS.visDzFallbackM || 7000;
        }
        const floor = THRESHOLDS.visDzMinM || 2000;
        if (visM < floor) {
            visM = floor;
        }
        return visM;
    }

    function visibilityFromState(hour, { forProb = false } = {}) {
        const fogTable = forProb ? THRESHOLDS.visFogProb : THRESHOLDS.visFog;
        if (Number.isFinite(hour.fogCat) && hour.fogCat >= 1) {
            return fogTable[hour.fogCat] || fogTable[1] || 3000;
        }
        if (Number.isFinite(hour.freezingFogCat) && hour.freezingFogCat >= 1) {
            return fogTable[hour.freezingFogCat] || fogTable[2] || 1500;
        }
        if ((hour.tsMm || 0) >= THRESHOLDS.visTsMm || (hour.weather || []).includes('TSRA')) {
            const cbBase = cbBaseFtFromClouds(hour.clouds)
                || (Number.isFinite(hour.lclFt) ? Math.max(1000, hour.lclFt) : null)
                || hour.omCloudBaseFt;
            return visibilityFromCbBaseFt(cbBase);
        }
        // Drizzle: depth / proximity — not precip amount.
        if (hourLooksLikeDrizzle(hour)) {
            return visibilityFromDrizzle(hour);
        }
        // RA / SHRA / SN: precip-amount ladder (need a real rate — not bare OM codes).
        if (meaningfulWetPrecip(hour) || (hour.snowMm || 0) >= THRESHOLDS.snowMm) {
            const mm = Math.max(precipAmountMm(hour), convectivePrecipMm(hour), hour.snowMm || 0);
            return visibilityFromPrecipAmount(mm);
        }
        return 9999;
    }

    function fogOrMistCode(hour, visM, { forProb = false } = {}) {
        const hasFogSignal = (Number.isFinite(hour.fogCat) && hour.fogCat >= 1)
            || (Number.isFinite(hour.freezingFogCat) && hour.freezingFogCat >= 1);
        if (!hasFogSignal || !Number.isFinite(visM)) {
            return null;
        }
        const freezing = Number.isFinite(hour.freezingFogCat) && hour.freezingFogCat >= 1;
        const fogCeil = forProb ? THRESHOLDS.fogVisMaxMProb : THRESHOLDS.fogVisMaxM;
        // Soft PROB bias: FG ceiling raised (default 1500 m) so borderline cases
        // encode as FG rather than BR; weak cat-1 signals can still remain BR.
        if (visM <= fogCeil) {
            return freezing ? 'FZFG' : 'FG';
        }
        if (visM >= THRESHOLDS.mistVisMinM && visM <= THRESHOLDS.mistVisMaxM) {
            return 'BR';
        }
        return null;
    }

    function fogPolicyCategory(hour) {
        const fog = Number.isFinite(hour?.fogCat) ? hour.fogCat : 0;
        const freezing = Number.isFinite(hour?.freezingFogCat) ? hour.freezingFogCat : 0;
        return Math.max(fog, freezing);
    }

    /** F3→BKN001; F1/F2 (BR) → BKN002 for lifted fog / very low stratus. */
    function fogProbClouds(hour) {
        const cat = fogPolicyCategory(hour);
        const bases = THRESHOLDS.fogProbCloudFt || {};
        let baseFt = bases[cat];
        if (!Number.isFinite(baseFt) && cat >= 1) {
            baseFt = bases[1] || bases[2] || 200;
        }
        if (!Number.isFinite(baseFt)) {
            return [];
        }
        return [{ amount: 'BKN', baseFt }];
    }

    /**
     * Fog category to encode on a PROB line for a fog slice.
     * F3 → FG; F1/F2 → BR (policy F2 is mist-class for draft PROB).
     */
    function fogProbRepresentativeCategory(slice) {
        const cats = (slice || []).map(fogPolicyCategory);
        if (!cats.length) {
            return 0;
        }
        const maxCat = Math.max(0, ...cats);
        if (maxCat <= 0) {
            return 0;
        }
        if (cats.some((cat) => cat >= 3)) {
            return 3;
        }
        return 1;
    }

    /** Snap fog/freezing-fog cats to the PROB representative (FG vs BR). */
    function applyFogProbCategory(hour, cat) {
        if (!hour || !Number.isFinite(cat) || cat < 1) {
            return hour;
        }
        const freezing = Number.isFinite(hour.freezingFogCat) && hour.freezingFogCat >= 1;
        if (freezing) {
            return { ...hour, freezingFogCat: cat, fogCat: 0 };
        }
        return { ...hour, fogCat: cat };
    }

    /**
     * Re-encode a fog/mist hour with PROB FG bias (vis, weather, FG cloud).
     * Does not change non-fog hours.
     */
    function withFogProbBias(hour) {
        if (!hourHasFog(hour) && fogPolicyCategory(hour) < 1) {
            return hour;
        }
        const visM = visibilityFromState(hour, { forProb: true });
        const fogMist = fogOrMistCode(hour, visM, { forProb: true });
        const weather = WX_PRECEDENCE.filter((code) => {
            if (code === 'FG' || code === 'FZFG' || code === 'BR') {
                return code === fogMist;
            }
            return (hour.weather || []).includes(code);
        }).slice(0, 3);
        if (fogMist && !weather.includes(fogMist)) {
            weather.unshift(fogMist);
        }
        const isFg = fogMist === 'FG' || fogMist === 'FZFG';
        const isBr = fogMist === 'BR';
        return {
            ...hour,
            visM,
            weather: weather.slice(0, 3),
            // FG → BKN001; BR → BKN002 (very low cloud travels with the PROB).
            clouds: (isFg || isBr) ? fogProbClouds(hour) : [],
            cavok: false,
        };
    }

    function weatherCodesFromState(hour, visM) {
        const codes = [];
        const fogMist = fogOrMistCode(hour, visM);
        if (fogMist) {
            codes.push(fogMist);
        }
        const omCode = hour.omWeatherCode;
        if ((hour.tsMm || 0) >= THRESHOLDS.precipTsMm || omCode === 95 || omCode === 96 || omCode === 99) {
            codes.push('TSRA');
        } else if (isShoweryPrecip(hour)) {
            codes.push('SHRA');
        } else if (precipAmountMm(hour) >= THRESHOLDS.precipRainMm) {
            codes.push('RA');
        } else if (hasDrizzleSignal(hour)) {
            codes.push('DZ');
        }
        if ((hour.snowMm || 0) >= THRESHOLDS.snowMm || omCode === 71 || omCode === 73 || omCode === 75) {
            codes.push('SN');
        }
        return dedupeWeatherCodes(codes).slice(0, 3);
    }

    function cloudsFromState(hour) {
        const amount = cloudAmountFromRh(hour.lowCloudRh)
            || cloudAmountFromRh(hour.omLowCloudCover)
            || cloudAmountFromRh(hour.surfaceRh);
        if (!amount) {
            return [];
        }
        const resolved = resolveCloudBaseFt(hour);
        const rawBaseFt = Number.isFinite(resolved) ? Math.max(100, resolved) : 2000;
        return [{ amount, baseFt: snapCloudBaseFt(rawBaseFt) }];
    }

    function enrichHourState(raw) {
        const visM = visibilityFromState(raw);
        const weather = weatherCodesFromState(raw, visM);
        const clouds = cloudsFromState(raw);
        const hasSignificantCloud = clouds.some((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC') && cloud.baseFt < THRESHOLDS.cavokCloudFt
        ));
        const cavok = visM >= THRESHOLDS.cavokVisM
            && weather.length === 0
            && !hasSignificantCloud;
        return {
            ...raw,
            weather,
            clouds,
            visM,
            cavok,
            windGroup: formatWindGroup(raw.windKt, raw.windDir, raw.gustKt),
        };
    }

    function formatVis(visM) {
        if (!Number.isFinite(visM) || visM >= 9999) {
            return '9999';
        }
        if (visM < 1000) {
            return String(Math.max(0, Math.round(visM / 100) * 100)).padStart(4, '0');
        }
        return String(Math.min(9999, Math.round(visM / 100) * 100));
    }

    function hasTempoProbWindWeather(hour) {
        return (hour?.weather || []).some((code) => THRESHOLDS.tempoProbWindWx.includes(code));
    }

    function shouldIncludeWindInTempoProb(hour, base) {
        // Thunderstorm PROB groups always carry a VRB gusted wind group.
        if (hourHasTs(hour)) {
            return true;
        }
        if (!hasTempoProbWindWeather(hour)) {
            return false;
        }
        const windKt = hour?.windKt;
        const gustKt = hour?.gustKt;
        const baseWindKt = base?.windKt;
        if (!Number.isFinite(windKt) || !Number.isFinite(gustKt) || !Number.isFinite(baseWindKt)) {
            return false;
        }
        return windKt > THRESHOLDS.tempoProbWindMinKt
            && gustKt > THRESHOLDS.tempoProbGustMinKt
            && windKt > baseWindKt + THRESHOLDS.tempoProbWindDeltaKt;
    }

    function resolveChangeGroupWind(hour, base, { isProb = false, refMean = null } = {}) {
        if (isProb && hourHasTs(hour)) {
            return formatThunderstormProbWind(hour, refMean || base);
        }
        if (shouldIncludeWindInTempoProb(hour, base) && !hourHasTs(hour)) {
            return hour.windGroup || formatWindGroup(hour.windKt, hour.windDir, hour.gustKt);
        }
        return null;
    }

    /**
     * TAF cloud cleanup for layers above ceiling:
     * - Ceiling = lowest BKN/OVC base, else if both FEW and SCT are present the
     *   higher of those two (FEW+SCT counts as a BKN ceiling for filtering only).
     * - Drop non-CB layers above that ceiling; keep FEW/SCT themselves as FEW/SCT.
     * - CB layers are kept even when above the ceiling.
     */
    function normalizeCloudLayers(clouds) {
        let layers = (clouds || []).map((cloud) => ({ ...cloud }));
        const cbLayers = layers.filter((cloud) => cloud.convective === 'CB');
        let nonCb = layers.filter((cloud) => cloud.convective !== 'CB');

        const bknOvcBases = nonCb
            .filter((cloud) => cloud.amount === 'BKN' || cloud.amount === 'OVC')
            .map((cloud) => cloud.baseFt)
            .filter((base) => Number.isFinite(base));
        const fewBases = nonCb
            .filter((cloud) => cloud.amount === 'FEW')
            .map((cloud) => cloud.baseFt)
            .filter((base) => Number.isFinite(base));
        const sctBases = nonCb
            .filter((cloud) => cloud.amount === 'SCT')
            .map((cloud) => cloud.baseFt)
            .filter((base) => Number.isFinite(base));

        let ceilingFt = null;
        if (bknOvcBases.length) {
            ceilingFt = Math.min(...bknOvcBases);
        } else if (fewBases.length && sctBases.length) {
            // FEW+SCT ⇒ BKN-equivalent ceiling at the higher of the lowest FEW
            // and lowest SCT bases (layers stay FEW/SCT; only used to clip above).
            ceilingFt = Math.max(Math.min(...fewBases), Math.min(...sctBases));
        }

        if (Number.isFinite(ceilingFt)) {
            nonCb = nonCb.filter((cloud) => (
                Number.isFinite(cloud.baseFt) && cloud.baseFt <= ceilingFt
            ));
        }

        nonCb.sort((a, b) => (a.baseFt || 0) - (b.baseFt || 0));
        cbLayers.sort((a, b) => (a.baseFt || 0) - (b.baseFt || 0));
        return [...nonCb, ...cbLayers];
    }

    function formatConditionBody(hour, options = {}) {
        if (!hour) {
            return '';
        }
        const windGroup = Object.prototype.hasOwnProperty.call(options, 'windGroup')
            ? options.windGroup
            : (options.includeWind === false ? null : hour.windGroup);
        const allowTsra = options.allowTsra === true;
        const allowRaDz = options.allowRaDz !== false;
        const meanStyle = options.meanStyle === true;
        const holdingStyle = options.holdingStyle === true;
        const rawWeather = allowTsra ? (hour.weather || []) : weatherWithoutTsra(hour.weather);
        const weather = dedupeWeatherCodes(rawWeather, { allowRaDz });
        const hasTsra = allowTsra && weather.includes('TSRA');
        const hasFg = weather.includes('FG') || weather.includes('FZFG');
        const hasBrOnly = weather.includes('BR') && !hasFg;
        let clouds = hour.clouds || [];
        let visM = hour.visM;
        if (hasTsra) {
            clouds = ensureTsraCbClouds(hour);
            visM = visibilityFromCbBaseFt(cbBaseFtFromClouds(clouds));
        } else if (hasBrOnly) {
            // BR carries BKN002 when present (lifted fog / very low stratus).
            if (!clouds.length) {
                clouds = fogProbClouds(hour);
            }
        } else if (hasFg && !clouds.length) {
            clouds = fogProbClouds(hour);
        }
        // Mean/FM lines never publish restricted vis — TEMPO/PROB carry cuts.
        if (meanStyle) {
            visM = THRESHOLDS.meanVisM || 9999;
        }
        clouds = normalizeCloudLayers(clouds);
        if (holdingStyle) {
            clouds = promoteHoldingCloudAmounts(clouds, hour);
        }
        // CAVOK is incompatible with TSRA / CB. Mean lines prefer CAVOK over "9999 NSC".
        const cloudTextPreview = clouds
            .map((cloud) => formatCloudGroup(cloud.amount, cloud.baseFt, cloud.convective || null))
            .filter(Boolean);
        const meanWouldBeNsc = meanStyle
            && !hasTsra
            && weather.length === 0
            && cloudTextPreview.length === 0
            && !clouds.some((cloud) => cloud.convective === 'CB');
        if ((hour.cavok || meanWouldBeNsc) && !hasTsra && weather.length === 0) {
            return windGroup ? `${windGroup} CAVOK` : 'CAVOK';
        }
        const parts = [];
        if (windGroup) {
            parts.push(windGroup);
        }
        parts.push(formatVis(visM));
        const wxText = formatWeatherGroups(weather, hour, { meanStyle, holdingStyle });
        if (wxText) {
            parts.push(wxText);
        } else if (meanStyle && options.requireNsw === true) {
            parts.push('NSW');
        }
        if (cloudTextPreview.length) {
            parts.push(cloudTextPreview.join(' '));
        } else if (!hasBrOnly) {
            parts.push('NSC');
        }
        return parts.join(' ');
    }

    function angularDiff(a, b) {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return 0;
        }
        let diff = Math.abs(a - b) % 360;
        if (diff > 180) {
            diff = 360 - diff;
        }
        return diff;
    }

    function bknOvcBaseFt(hour) {
        const cloud = (hour?.clouds || []).find((entry) => entry.amount === 'BKN' || entry.amount === 'OVC');
        return Number.isFinite(cloud?.baseFt) ? cloud.baseFt : null;
    }

    function snapTempoCloudBaseFt(baseFt) {
        if (!Number.isFinite(baseFt) || baseFt > THRESHOLDS.tempoCloudMaxFt) {
            return null;
        }
        for (const band of THRESHOLDS.tempoCloudBasesFt) {
            if (baseFt <= band) {
                return band;
            }
        }
        return null;
    }

    function tempoCloudBand(hour) {
        return snapTempoCloudBaseFt(bknOvcBaseFt(hour)) ?? Number.POSITIVE_INFINITY;
    }

    function tempoVisBand(hour) {
        const visM = hour?.visM;
        if (!Number.isFinite(visM) || visM > THRESHOLDS.tempoVisMaxM) {
            return Number.POSITIVE_INFINITY;
        }
        for (const band of THRESHOLDS.tempoVisBandsM) {
            if (visM <= band) {
                return band;
            }
        }
        return Number.POSITIVE_INFINITY;
    }

    function tempoEligible(hour) {
        const cloudBase = bknOvcBaseFt(hour);
        const lowCloud = Number.isFinite(cloudBase) && cloudBase <= THRESHOLDS.tempoCloudMaxFt;
        const lowVis = Number.isFinite(hour?.visM) && hour.visM <= THRESHOLDS.tempoVisMaxM;
        return lowCloud || lowVis;
    }

    function tempoSignificantVsBase(base, hour) {
        if (!tempoEligible(hour)) {
            return false;
        }
        return tempoCloudBand(hour) < tempoCloudBand(base)
            || tempoVisBand(hour) < tempoVisBand(base);
    }

    function significantChange(a, b) {
        if (!a || !b) {
            return true;
        }
        if (Math.abs((a.windKt || 0) - (b.windKt || 0)) >= THRESHOLDS.windChangeKt) {
            return true;
        }
        if (angularDiff(a.windDir, b.windDir) >= THRESHOLDS.windChangeDeg && Math.max(a.windKt || 0, b.windKt || 0) >= 6) {
            return true;
        }
        if (tempoVisBand(a) !== tempoVisBand(b) || formatVis(a.visM) !== formatVis(b.visM)) {
            return true;
        }
        if ((a.weather || []).join('/') !== (b.weather || []).join('/')) {
            return true;
        }
        if (Boolean(a.cavok) !== Boolean(b.cavok)) {
            return true;
        }
        if (tempoCloudBand(a) !== tempoCloudBand(b)) {
            return true;
        }
        const aCloud = a.clouds?.[0];
        const bCloud = b.clouds?.[0];
        if ((aCloud?.amount || 'NSC') !== (bCloud?.amount || 'NSC')) {
            return true;
        }
        return false;
    }

    function withTempoSnappedClouds(hour) {
        if (!hour?.clouds?.length) {
            return hour;
        }
        const snapped = hour.clouds.map((cloud) => {
            if (cloud.amount !== 'BKN' && cloud.amount !== 'OVC') {
                return cloud;
            }
            const nextBase = snapTempoCloudBaseFt(cloud.baseFt);
            return nextBase == null ? cloud : { ...cloud, baseFt: nextBase };
        });
        // Demote casual OVC → BKN; promote FEW/low SCT only when cover is solid.
        return temperHoldingClouds({
            ...hour,
            clouds: promoteHoldingCloudAmounts(snapped, hour),
        });
    }

    const PRECIP_WX = new Set(['SHRA', 'RA', 'DZ', 'SN']);

    function precipCodesFromHour(hour) {
        const fromWx = (hour?.weather || []).filter((code) => PRECIP_WX.has(code));
        if (fromWx.length) {
            return fromWx;
        }
        const codes = [];
        const omCode = hour?.omWeatherCode;
        if ((hour?.tsMm || 0) >= THRESHOLDS.precipTsMm
            || omCode === 95
            || omCode === 96
            || omCode === 99) {
            return codes;
        }
        if (isShoweryPrecip(hour)) {
            codes.push('SHRA');
        } else if (precipAmountMm(hour) >= THRESHOLDS.precipRainMm) {
            codes.push('RA');
        } else if (hasDrizzleSignal(hour)) {
            codes.push('DZ');
        }
        if ((hour?.snowMm || 0) >= THRESHOLDS.snowMm
            || omCode === 71
            || omCode === 73
            || omCode === 75) {
            codes.push('SN');
        }
        return codes;
    }

    /**
     * TEMPO lines are built from the single "worst" hour in a run, which can
     * keep low cloud while dropping SHRA/RA and vis cuts that appear on other
     * hours in the same TEMPO window. Fold precip + vis from the whole slice.
     * Also folds light residual precip after TSRA that sits under the TEMPO
     * cloud spell but never crossed the shower threshold alone.
     */
    function enrichTempoStateFromSlice(state, slice) {
        if (!state || !slice?.length) {
            return state;
        }
        const precip = new Set();
        let maxPrecipMm = 0;
        let maxConvectiveMm = 0;
        let sawStormInSlice = false;
        slice.forEach((hour) => {
            precipCodesFromHour(hour).forEach((code) => precip.add(code));
            if (hourHasTs(hour) || (hour.tsMm || 0) >= THRESHOLDS.precipTsMm) {
                sawStormInSlice = true;
            }
            maxPrecipMm = Math.max(
                maxPrecipMm,
                Number(hour.precipMm) || 0,
                Number(hour.omPrecipMm) || 0,
            );
            maxConvectiveMm = Math.max(maxConvectiveMm, convectivePrecipMm(hour));
        });
        const tempoPrecipMin = THRESHOLDS.tempoPrecipMinMm
            || THRESHOLDS.convectivePrecipMinMm
            || THRESHOLDS.precipRainMm
            || 0.2;
        const wetEnoughForTempo = Math.max(maxPrecipMm, maxConvectiveMm) >= tempoPrecipMin;
        // Trace showers under a low-cloud TEMPO must not become -SHRA.
        if (!wetEnoughForTempo) {
            precip.delete('SHRA');
            precip.delete('RA');
            precip.delete('SN');
        }
        // Residual precip under a low-cloud TEMPO: SHRA if convective, else RA.
        if (!precip.size && wetEnoughForTempo) {
            const showery = sawStormInSlice || slice.some(isShoweryPrecip);
            precip.add(showery ? 'SHRA' : 'RA');
        }
        if (!precip.size) {
            // Drop any weak SHRA/RA that arrived via worstState hour.weather.
            const cleaned = (state.weather || []).filter((code) => !PRECIP_WX.has(code));
            if (cleaned.length === (state.weather || []).length) {
                return state;
            }
            return { ...state, weather: cleaned };
        }
        // TEMPO never carries TSRA — that stays on PROB lines.
        precip.delete('TSRA');
        // Allow RA+DZ → RADZ on TEMPO when the spell has both regimes.
        const weather = dedupeWeatherCodes([
            ...precip,
            ...(state.weather || []).filter((code) => !PRECIP_WX.has(code) && code !== 'TSRA'),
        ], { allowRaDz: true }).slice(0, 3);
        let visM = Number.isFinite(state.visM) ? state.visM : 9999;
        let worstDzHour = null;
        slice.forEach((hour) => {
            const wet = precipCodesFromHour(hour).length > 0
                || precipAmountMm(hour) >= THRESHOLDS.precipRainMm
                || hourLooksLikeDrizzle(hour);
            if (!wet) {
                return;
            }
            if (Number.isFinite(hour.visM)) {
                visM = Math.min(visM, hour.visM);
            }
            visM = Math.min(visM, visibilityFromState(hour));
            if (hourLooksLikeDrizzle(hour)) {
                worstDzHour = hour;
            }
        });
        // Fallbacks when wet hours never set a restricted vis (same helpers as hourly).
        if (visM >= 9999) {
            if (precip.has('SHRA') || precip.has('RA') || precip.has('SN')) {
                visM = visibilityFromPrecipAmount(
                    Math.max(maxPrecipMm, THRESHOLDS.precipRainMm),
                );
            } else if (precip.has('DZ')) {
                visM = visibilityFromDrizzle(worstDzHour || state);
            }
        }
        return {
            ...state,
            weather,
            visM,
            cavok: false,
        };
    }

    function lowCeilingCloud(state) {
        return (state?.clouds || []).find((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC')
            && cloud.convective !== 'CB'
        )) || null;
    }

    function snapTempoBandAtOrBelow(baseFt) {
        const bands = THRESHOLDS.tempoCloudBasesFt;
        let chosen = bands[0];
        for (const band of bands) {
            if (band <= baseFt) {
                chosen = band;
            } else {
                break;
            }
        }
        return chosen;
    }

    function nextLowerTempoBand(baseFt) {
        const bands = THRESHOLDS.tempoCloudBasesFt;
        const below = bands.filter((band) => band < baseFt);
        return below.length ? below[below.length - 1] : bands[0];
    }

    function setLowCeilingCloud(state, baseFt, preferAmount = 'BKN') {
        const clouds = (state?.clouds || []).map((cloud) => ({ ...cloud }));
        const idx = clouds.findIndex((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC')
            && cloud.convective !== 'CB'
        ));
        // Holdings: keep OVC only when strongly overcast; otherwise BKN.
        // 'FORCE_BKN' locks BKN (storm PROB BKN002 — never OVC001).
        const forceBkn = preferAmount === 'FORCE_BKN';
        const allowOvc = !forceBkn
            && (preferAmount === 'OVC' || cloudIsStrongOvercast(state));
        let amount = preferAmount === 'OVC' && allowOvc ? 'OVC' : 'BKN';
        if (!forceBkn && idx >= 0 && clouds[idx].amount === 'OVC' && allowOvc) {
            amount = 'OVC';
        }
        const entry = { amount, baseFt };
        if (idx >= 0) {
            clouds[idx] = { ...clouds[idx], ...entry };
        } else {
            clouds.unshift(entry);
        }
        return { ...state, clouds, cavok: false };
    }

    function meanActiveWindow(means, index) {
        const start = means[index].startMs;
        const end = index + 1 < means.length
            ? means[index + 1].startMs
            : Number.POSITIVE_INFINITY;
        return { start, end };
    }

    function rangesOverlap(a0, a1, b0, b1) {
        return a0 < b1 && b0 < a1;
    }

    /**
     * Fatal structure fix: a mean FM/BECMG must never put BKN/OVC at or below a
     * coincident TEMPO ceiling. Progressive cloud-onset FMs that violate this are
     * collapsed into a BECMG above a lowered TEMPO (e.g. BECMG … SCT008 BKN012
     * with TEMPO BKN008), while post-spell CAVOK FMs are kept.
     */
    function resolveMeanTempoCloudConflicts(groups, headerBase) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        let means = groups.filter(isMeanChangeGroup).slice().sort(byStart);
        const tempos = groups.filter((group) => group.kind === 'TEMPO').slice();
        const rest = groups.filter((group) => !isMeanChangeGroup(group) && group.kind !== 'TEMPO');
        if (!means.length || !tempos.length) {
            return groups;
        }

        const meanId = (group) => group;
        tempos.forEach((tempo) => {
            const tempoBase = lowCeilingCloud(tempo.state)?.baseFt;
            if (!Number.isFinite(tempoBase)) {
                return;
            }

            const overlapping = [];
            means.forEach((mean, index) => {
                const { start, end } = meanActiveWindow(means, index);
                if (!rangesOverlap(start, end, tempo.startMs, tempo.endExclusiveMs)) {
                    return;
                }
                overlapping.push({ mean, index });
            });
            if (!overlapping.length) {
                return;
            }

            const cloudyOverlap = overlapping.filter(({ mean }) => (
                Number.isFinite(meanSignificantCloudBaseFt(mean.state))
            ));
            if (!cloudyOverlap.length) {
                return;
            }

            const minMeanBase = Math.min(
                ...cloudyOverlap.map(({ mean }) => meanSignificantCloudBaseFt(mean.state)),
            );
            const minGap = THRESHOLDS.precipMeanTempoMinGapFt || 200;
            const precipStorm = holdingHasPrecipStorm(tempo.state);
            // Already a real step above TEMPO — dry/fog done; precip still gets SCT+BKN.
            if (!precipStorm && minMeanBase > tempoBase) {
                return;
            }
            if (precipStorm && minMeanBase >= tempoBase + minGap) {
                cloudyOverlap.forEach(({ mean }) => {
                    const stack = precipMeanCloudStack(tempoBase);
                    const code = primaryPrecipCode(mean.state) || primaryPrecipCode(tempo.state);
                    mean.state = normalizeMeanState({
                        ...mean.state,
                        weather: code
                            ? dedupeWeatherCodes([code, ...(mean.state.weather || [])])
                            : (mean.state.weather || []),
                        clouds: stack,
                        cavok: false,
                    }, { liftClouds: false });
                });
                return;
            }

            // Target stack: BKN006 over TEMPO BKN004; BKN008 over OVC005; BKN012 over 008.
            // Higher pair only when means were already well above 1500.
            const highestMeanBase = Math.max(
                ...cloudyOverlap.map(({ mean }) => meanSignificantCloudBaseFt(mean.state)),
            );
            let targetTempoFt = tempoBase;
            let targetMeanFt = meanBknAboveTempoFt(tempoBase) || 800;
            if (highestMeanBase >= 1800 && tempoBase >= 1500) {
                targetMeanFt = 1800;
                targetTempoFt = 1200;
            } else if (precipStorm && minMeanBase - tempoBase < minGap) {
                // Too tight (BKN006 / OVC005): drop TEMPO one ladder band (500→400).
                targetTempoFt = nextLowerTempoBand(tempoBase);
                if (
                    minMeanBase <= 600
                    && targetTempoFt < 400
                    && (THRESHOLDS.tempoCloudBasesFt || []).includes(400)
                    && minMeanBase - 400 >= minGap
                ) {
                    targetTempoFt = 400;
                }
                targetMeanFt = meanBknAboveTempoFt(targetTempoFt) || Math.max(minMeanBase, targetTempoFt + minGap);
            } else if (minMeanBase > 0 && minMeanBase <= 500 && tempoBase > 500) {
                // Dry / non-fog: never invent fog-depth TEMPO (BKN003/005) to sit under mean.
                targetTempoFt = precipStorm || hourHasFog(tempo.state) ? 500 : 800;
                targetMeanFt = meanBknAboveTempoFt(targetTempoFt) || 800;
            }
            targetMeanFt = parkMeanBknBaseFt(targetMeanFt);
            targetTempoFt = snapTempoBandAtOrBelow(targetTempoFt);
            const dryTempoFloor = 800;
            while (targetTempoFt >= targetMeanFt && targetTempoFt > THRESHOLDS.tempoCloudBasesFt[0]) {
                targetTempoFt = nextLowerTempoBand(targetTempoFt);
            }
            if (
                !precipStorm
                && !hourHasFog(tempo.state)
                && targetTempoFt < dryTempoFloor
            ) {
                // Cannot stack dry TEMPO under mean without fog depths — raise mean instead.
                targetTempoFt = dryTempoFloor;
                if (targetMeanFt <= targetTempoFt) {
                    targetMeanFt = meanBknAboveTempoFt(targetTempoFt) || 1200;
                }
            }
            tempo.state = setLowCeilingCloud(
                tempo.state,
                targetTempoFt,
                precipStorm ? 'FORCE_BKN' : 'BKN',
            );

            // precip_storm: SCT at TEMPO + BKN above / keep FM story — never collapse into BECMG.
            if (precipStorm) {
                const stack = precipMeanCloudStack(targetTempoFt);
                cloudyOverlap.forEach(({ mean }) => {
                    const code = primaryPrecipCode(mean.state) || primaryPrecipCode(tempo.state);
                    mean.state = normalizeMeanState({
                        ...mean.state,
                        weather: code
                            ? dedupeWeatherCodes([code, ...(mean.state.weather || [])])
                            : (mean.state.weather || []),
                        clouds: stack,
                        cavok: false,
                    }, { liftClouds: false });
                });
                return;
            }

            // cloud_br / dry: collapse progressive cloudy means into one BECMG.
            const collapse = cloudyOverlap.filter(({ mean }) => !(
                mean.startMs >= tempo.endExclusiveMs
                && (mean.state?.cavok || !meanSignificantCloudBaseFt(mean.state))
            ));
            if (!collapse.length) {
                cloudyOverlap.forEach(({ mean }) => {
                    mean.state = normalizeMeanState({
                        ...mean.state,
                        clouds: [
                            { amount: 'SCT', baseFt: targetTempoFt },
                            { amount: 'BKN', baseFt: targetMeanFt },
                        ],
                        cavok: false,
                    }, { liftClouds: false });
                });
                return;
            }

            const collapseSet = new Set(collapse.map(({ mean }) => meanId(mean)));
            const windSource = collapse[collapse.length - 1].mean.state
                || collapse[0].mean.state
                || headerBase;
            const becmgHours = Math.max(1, Math.min(2, THRESHOLDS.becmgHours || 2));
            const alignedStart = tempo.startMs;
            const endExclusiveMs = alignedStart + (becmgHours * 60 * 60 * 1000);
            const becmg = {
                kind: 'BECMG',
                meanPriority: 'mandatory',
                meanSource: 'tempo-cloud-reconcile',
                requireNsw: false,
                state: normalizeMeanState({
                    ...windSource,
                    weather: (windSource.weather || []).filter((code) => !PROB_WEATHER.has(code)),
                    clouds: [
                        { amount: 'SCT', baseFt: targetTempoFt },
                        { amount: 'BKN', baseFt: targetMeanFt },
                    ],
                    cavok: false,
                }, { liftClouds: false }),
                startMs: alignedStart,
                endExclusiveMs,
                sortKey: alignedStart,
                text: '',
            };
            means = means
                .filter((mean) => !collapseSet.has(meanId(mean)))
                .concat([becmg])
                .sort(byStart);
        });

        // Final pass: any remaining TEMPO ≥ active mean ceiling steps down.
        means.forEach((mean, index) => {
            const meanBase = meanSignificantCloudBaseFt(mean.state);
            if (!Number.isFinite(meanBase)) {
                return;
            }
            const { start, end } = meanActiveWindow(means, index);
            tempos.forEach((tempo) => {
                if (!rangesOverlap(start, end, tempo.startMs, tempo.endExclusiveMs)) {
                    return;
                }
                const tempoBase = lowCeilingCloud(tempo.state)?.baseFt;
                if (!Number.isFinite(tempoBase) || tempoBase < meanBase) {
                    return;
                }
                let target = nextLowerTempoBand(meanBase);
                target = snapTempoBandAtOrBelow(target);
                while (target >= meanBase && target > THRESHOLDS.tempoCloudBasesFt[0]) {
                    target = nextLowerTempoBand(target);
                }
                if (
                    !holdingHasPrecipStorm(tempo.state)
                    && !hourHasFog(tempo.state)
                    && target < 800
                ) {
                    // Leave dry TEMPO alone rather than inventing BKN003 under the mean.
                    return;
                }
                tempo.state = setLowCeilingCloud(tempo.state, target);
            });
        });

        return [...means, ...tempos, ...rest].sort(byStart);
    }

    function isLowCloudTempo(group) {
        if (group?.kind !== 'TEMPO') {
            return false;
        }
        const baseFt = lowCeilingCloud(group.state)?.baseFt;
        return Number.isFinite(baseFt) && baseFt <= (THRESHOLDS.tempoCloudMaxFt || 1500);
    }

    function isLowCloudMean(group) {
        if (!isMeanChangeGroup(group)) {
            return false;
        }
        const baseFt = meanSignificantCloudBaseFt(group.state);
        return Number.isFinite(baseFt) && baseFt <= (THRESHOLDS.tempoCloudMaxFt || 1500);
    }

    /**
     * cloud_br episodes only (YABA): one onset BECMG + one clear BECMG.
     * Never runs on precip_storm clusters (YLHI) — those keep FM + stepped TEMPOs.
     */
    function compressLowCloudEpisodeMeans(groups, headerBase) {
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        let means = groups.filter(isMeanChangeGroup).slice().sort(byStart);
        let tempos = groups.filter((group) => group.kind === 'TEMPO').slice().sort(byStart);
        const probs = groups.filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40');
        const rest = groups.filter((group) => (
            !isMeanChangeGroup(group)
            && group.kind !== 'TEMPO'
            && group.kind !== 'PROB30'
            && group.kind !== 'PROB40'
        ));
        const allEpisodes = classifyHoldingEpisodes(tempos, probs);
        const precipStormEpisodes = allEpisodes.filter((episode) => episode.class === 'precip_storm');
        let episodes = allEpisodes.filter((episode) => episode.class === 'cloud_br');
        // Pre-storm dry-cloud lead-in that abuts SHRA/RA/TSRA must NOT get YABA
        // compression (invented BKN006 + CAVOK clear right as showers start).
        const abutMs = 60 * 60 * 1000;
        episodes = episodes.filter((episode) => !precipStormEpisodes.some((storm) => (
            Math.abs(episode.endMs - storm.startMs) <= abutMs
            || (episode.endMs >= storm.startMs && episode.startMs <= storm.startMs)
        )));
        if (!episodes.length) {
            return groups;
        }

        const bridgeMs = 2 * 60 * 60 * 1000;
        // Extend each cloud_br episode through nearby low-cloud means (orphan FM).
        episodes.forEach((episode) => {
            means.forEach((mean) => {
                if (!isLowCloudMean(mean)) {
                    return;
                }
                if (mean.startMs < episode.startMs || mean.startMs > episode.endMs + bridgeMs) {
                    return;
                }
                episode.endMs = Math.max(episode.endMs, mean.startMs);
            });
            // Only compress dry/DZ low-cloud TEMPOs inside this episode.
            episode.tempos = (episode.tempos || []).filter((tempo) => (
                isLowCloudTempo(tempo) || primaryPrecipCode(tempo.state) === 'DZ'
            ));
        });

        const becmgHours = Math.max(1, Math.min(2, THRESHOLDS.becmgHours || 2));
        const removeMeans = new Set();
        const addMeans = [];
        const absorbTempos = new Set();

        episodes.forEach((episode) => {
            // Fog/BR PROB owns the shallow moist layer — drop dry OVC010 TEMPOs that
            // YPPH-style flooring invents beside BR (YMHB). Keep precip/DZ TEMPOs.
            const fogish = (episode.probs || []).some((group) => (
                hourHasFog(group.state) || fogPolicyCategory(group.state) >= 1
            ));
            if (fogish) {
                episode.tempos.forEach((tempo) => {
                    if (isDryLowCloudTempo(tempo)) {
                        absorbTempos.add(tempo);
                    }
                });
                episode.tempos = episode.tempos.filter((tempo) => !absorbTempos.has(tempo));
            }

            const elevatedFt = (() => {
                let best = null;
                [...(episode.probs || []), ...(episode.tempos || [])].forEach((group) => {
                    const ft = elevatedDeckFtFromState(group.state);
                    if (!Number.isFinite(ft)) {
                        return;
                    }
                    best = best == null ? ft : Math.max(best, ft);
                });
                return best;
            })();

            // Fog-only episode: elevated SCT mean + clear CAVOK — no TEMPO cloud line.
            if (fogish && !episode.tempos.length) {
                if (!Number.isFinite(elevatedFt)) {
                    return;
                }
                const clearStart = episode.endMs;
                const clearEnd = clearStart + (becmgHours * 60 * 60 * 1000);
                const precipFollows = precipStormEpisodes.some((storm) => (
                    Math.abs(storm.startMs - clearStart) <= abutMs
                    || (storm.startMs >= clearStart && storm.startMs < clearEnd)
                ));
                let onsetWind = headerBase;
                let clearWind = headerBase;
                means.forEach((mean) => {
                    if (mean.startMs < episode.startMs || mean.startMs >= clearEnd) {
                        return;
                    }
                    if (
                        isHoldingDrivenMean(mean)
                        && (mean.meanSource === 'holding-onset'
                            || mean.meanSource === 'holding-transition'
                            || mean.meanSource === 'holding-cessation')
                    ) {
                        return;
                    }
                    if (mean.startMs <= episode.startMs + bridgeMs) {
                        onsetWind = mean.state || onsetWind;
                    }
                    clearWind = mean.state || clearWind;
                    removeMeans.add(mean);
                });
                addMeans.push({
                    kind: 'BECMG',
                    meanPriority: 'mandatory',
                    meanSource: 'cloud-episode-onset',
                    requireNsw: false,
                    state: normalizeMeanState({
                        ...onsetWind,
                        elevatedCloudBaseFt: elevatedFt,
                        weather: (onsetWind.weather || []).filter((code) => (
                            !PROB_WEATHER.has(code)
                            && code !== 'SHRA'
                            && code !== 'RA'
                            && code !== 'SN'
                        )),
                        clouds: [{ amount: 'SCT', baseFt: elevatedFt }],
                        cavok: false,
                    }, { liftClouds: false }),
                    startMs: episode.startMs,
                    endExclusiveMs: episode.startMs + (becmgHours * 60 * 60 * 1000),
                    sortKey: episode.startMs,
                    text: '',
                });
                if (!precipFollows) {
                    addMeans.push({
                        kind: 'BECMG',
                        meanPriority: 'mandatory',
                        meanSource: 'cloud-episode-clear',
                        requireNsw: false,
                        state: normalizeMeanState({
                            ...clearWind,
                            weather: [],
                            clouds: [],
                            cavok: true,
                        }, { liftClouds: false }),
                        startMs: clearStart,
                        endExclusiveMs: clearEnd,
                        sortKey: clearStart,
                        text: '',
                    });
                }
                return;
            }

            if (!episode.tempos.length) {
                return;
            }
            const primary = episode.tempos[0];

            // Keep model TEMPO bases — never invent lower fog-like ceilings (006/005).
            let targetTempoFt = null;
            episode.tempos.forEach((tempo) => {
                const baseFt = lowCeilingCloud(tempo.state)?.baseFt;
                if (Number.isFinite(baseFt)) {
                    targetTempoFt = targetTempoFt == null ? baseFt : Math.min(targetTempoFt, baseFt);
                }
            });
            if (!Number.isFinite(targetTempoFt)) {
                targetTempoFt = 1200;
            }
            targetTempoFt = snapTempoBandAtOrBelow(targetTempoFt);
            if (!fogish && targetTempoFt < 800) {
                targetTempoFt = 800;
            }
            const liftedMean = meanCloudBaseFt(targetTempoFt);
            const targetMeanFt = parkMeanBknBaseFt(
                Number.isFinite(liftedMean)
                    ? Math.max(liftedMean, targetTempoFt + 400, 1200)
                    : Math.max(targetTempoFt + 400, 1200),
            );

            primary.endExclusiveMs = Math.max(primary.endExclusiveMs, episode.endMs);
            primary.state = temperHoldingClouds(
                setLowCeilingCloud(primary.state, targetTempoFt),
            );
            episode.tempos.slice(1).forEach((tempo) => {
                absorbTempos.add(tempo);
                primary.endExclusiveMs = Math.max(primary.endExclusiveMs, tempo.endExclusiveMs);
                const wx = new Set([...(primary.state.weather || []), ...(tempo.state.weather || [])]);
                primary.state = {
                    ...primary.state,
                    weather: dedupeWeatherCodes([...wx]),
                    visM: Math.min(
                        Number.isFinite(primary.state.visM) ? primary.state.visM : 9999,
                        Number.isFinite(tempo.state.visM) ? tempo.state.visM : 9999,
                    ),
                };
            });
            episode.endMs = primary.endExclusiveMs;

            const clearStart = episode.endMs;
            const clearEnd = clearStart + (becmgHours * 60 * 60 * 1000);
            const precipFollows = precipStormEpisodes.some((storm) => (
                Math.abs(storm.startMs - clearStart) <= abutMs
                || (storm.startMs >= clearStart && storm.startMs < clearEnd)
            ));
            let onsetWind = headerBase;
            let clearWind = headerBase;
            means.forEach((mean) => {
                // Keep means that start before the episode (e.g. earlier wind FM).
                if (mean.startMs < episode.startMs || mean.startMs >= clearEnd) {
                    return;
                }
                // Never strip precip_storm holding means if any slipped in.
                if (
                    isHoldingDrivenMean(mean)
                    && (mean.meanSource === 'holding-onset'
                        || mean.meanSource === 'holding-transition'
                        || mean.meanSource === 'holding-cessation')
                ) {
                    return;
                }
                if (mean.startMs <= episode.startMs + bridgeMs) {
                    onsetWind = mean.state || onsetWind;
                }
                clearWind = mean.state || clearWind;
                removeMeans.add(mean);
            });

            // Dry (YPPH) path: SCT at TEMPO base + BKN above. Fog+remaining TEMPO:
            // prefer elevated SCT only (no invented SCT010 stack).
            const onsetClouds = fogish && Number.isFinite(elevatedFt)
                ? [{ amount: 'SCT', baseFt: elevatedFt }]
                : [
                    { amount: 'SCT', baseFt: Math.min(targetTempoFt, targetMeanFt - 400) },
                    { amount: 'BKN', baseFt: targetMeanFt },
                ];

            addMeans.push({
                kind: 'BECMG',
                meanPriority: 'mandatory',
                meanSource: 'cloud-episode-onset',
                requireNsw: false,
                state: normalizeMeanState({
                    ...onsetWind,
                    elevatedCloudBaseFt: Number.isFinite(elevatedFt)
                        ? elevatedFt
                        : onsetWind.elevatedCloudBaseFt,
                    weather: (onsetWind.weather || []).filter((code) => (
                        !PROB_WEATHER.has(code)
                        && code !== 'SHRA'
                        && code !== 'RA'
                        && code !== 'SN'
                    )),
                    clouds: onsetClouds,
                    cavok: false,
                }, { liftClouds: false }),
                startMs: episode.startMs,
                endExclusiveMs: episode.startMs + (becmgHours * 60 * 60 * 1000),
                sortKey: episode.startMs,
                text: '',
            });
            // No CAVOK clear if showers/storms follow immediately — holding-onset owns that.
            if (!precipFollows) {
                addMeans.push({
                    kind: 'BECMG',
                    meanPriority: 'mandatory',
                    meanSource: 'cloud-episode-clear',
                    requireNsw: false,
                    state: normalizeMeanState({
                        ...clearWind,
                        weather: [],
                        clouds: [],
                        cavok: true,
                    }, { liftClouds: false }),
                    startMs: clearStart,
                    endExclusiveMs: clearEnd,
                    sortKey: clearStart,
                    text: '',
                });
            }
        });

        // Always drop fog-adjacent dry TEMPOs even when no replacement means are added.
        tempos = tempos.filter((tempo) => !absorbTempos.has(tempo));
        if (!addMeans.length) {
            if (!absorbTempos.size) {
                return groups;
            }
            return [...means, ...tempos, ...probs, ...rest].sort(byStart);
        }

        means = means
            .filter((mean) => !removeMeans.has(mean))
            .concat(addMeans)
            .sort(byStart);

        const meanRank = (group) => {
            if (group.meanSource === 'holding-onset' || group.meanSource === 'holding-cessation') {
                return 3;
            }
            if (group.meanSource === 'holding-transition') {
                return 2;
            }
            if (group.meanSource?.startsWith('cloud-episode')) {
                return 0;
            }
            return 1;
        };
        const deduped = [];
        means.forEach((mean) => {
            const prev = deduped[deduped.length - 1];
            if (prev && prev.startMs === mean.startMs) {
                if (meanRank(mean) > meanRank(prev)) {
                    deduped[deduped.length - 1] = mean;
                }
                return;
            }
            deduped.push(mean);
        });

        return [...deduped, ...tempos, ...probs, ...rest].sort(byStart);
    }

    /**
     * Keep significant ceilings stacked: PROB (TSRA) < TEMPO < forecast mean BKN/OVC.
     * Only adjusts TEMPOs that already have BKN/OVC — never invents BKN012 under
     * NSC/FEW for a vis/precip-only TEMPO. SCT/FEW on the header must not force
     * dry TEMPOs into fog depths (BKN003).
     */
    function enforceCloudCeilingHierarchy(base, groups) {
        const means = (groups || []).filter(isMeanChangeGroup);
        const tempos = groups.filter((group) => group.kind === 'TEMPO');
        const stormProbs = groups.filter((group) => (
            (group.kind === 'PROB30' || group.kind === 'PROB40')
            && !group.bareProb
            && hourHasTs(group.state)
        ));
        const dryTempoFloor = 800;

        tempos.forEach((group) => {
            const existing = lowCeilingCloud(group.state)?.baseFt;
            // Vis/precip-only TEMPO under a high mean: leave cloud as-is (often NSC).
            if (!Number.isFinite(existing)) {
                return;
            }
            const active = activeMeanStateAt(base, means, group.startMs);
            // BKN/OVC only — SCT005 on the header must not drag TEMPO to BKN003.
            const meanBase = meanSignificantCloudBaseFt(active);
            if (!Number.isFinite(meanBase)) {
                if (
                    !holdingHasPrecipStorm(group.state)
                    && !hourHasFog(group.state)
                    && existing < dryTempoFloor
                ) {
                    group.state = setLowCeilingCloud(group.state, dryTempoFloor);
                }
                return;
            }
            let target = snapTempoBandAtOrBelow(existing);
            while (target >= meanBase && target > THRESHOLDS.tempoCloudBasesFt[0]) {
                target = nextLowerTempoBand(target);
            }
            if (target >= meanBase) {
                // Cannot stack under the mean without fog depths — leave as-is.
                return;
            }
            if (
                !holdingHasPrecipStorm(group.state)
                && !hourHasFog(group.state)
                && target < dryTempoFloor
            ) {
                if (dryTempoFloor < meanBase) {
                    target = dryTempoFloor;
                } else {
                    return;
                }
            }
            group.state = setLowCeilingCloud(group.state, target);
        });

        /**
         * Snap storm PROB ceiling strictly below the coincident TEMPO band.
         * When TEMPO is already at 300, use BKN002 (not OVC001).
         */
        function snapStormProbBelowTempo(rawFt, tempoFloorFt) {
            const tempoBands = THRESHOLDS.tempoCloudBasesFt || [];
            const stormBands = THRESHOLDS.stormProbCloudBasesFt || [200];
            const bands = [...stormBands, ...tempoBands]
                .filter((band, index, all) => all.indexOf(band) === index)
                .sort((a, b) => a - b);
            const below = bands.filter((band) => band < tempoFloorFt);
            if (!below.length) {
                return stormBands[0] || 200;
            }
            // Prefer the highest band still under the TEMPO (BKN002 under OVC003).
            const floorBand = stormBands[0] || 200;
            const preferred = Number.isFinite(rawFt)
                ? Math.max(rawFt, floorBand)
                : below[below.length - 1];
            let chosen = below[0];
            below.forEach((band) => {
                if (band <= preferred) {
                    chosen = band;
                }
            });
            return Math.max(chosen, floorBand);
        }

        stormProbs.forEach((group) => {
            const overlappingTempos = tempos.filter((tempo) => rangesOverlap(
                group.startMs,
                group.endExclusiveMs,
                tempo.startMs,
                tempo.endExclusiveMs,
            ));
            const overlapBases = overlappingTempos
                .map((tempo) => lowCeilingCloud(tempo.state)?.baseFt)
                .filter((baseFt) => Number.isFinite(baseFt));
            const tempoFloor = overlapBases.length
                ? Math.min(...overlapBases)
                : (tempos.length
                    ? Math.min(...tempos.map((tempo) => (
                        lowCeilingCloud(tempo.state)?.baseFt ?? 2500
                    )))
                    : (meanSignificantCloudBaseFt(base) || 2500));
            const existing = lowCeilingCloud(group.state)?.baseFt;
            let target = Number.isFinite(existing)
                ? Math.min(existing, tempoFloor - 100)
                : tempoFloor - 100;
            if (tempoFloor <= 1200) {
                target = Math.min(target, 800);
            }
            target = snapStormProbBelowTempo(target, tempoFloor);
            // Storm holdings use BKN002-style low cloud — not OVC001.
            group.state = setLowCeilingCloud(group.state, target, 'FORCE_BKN');
            group.state = {
                ...group.state,
                clouds: ensureTsraCbClouds(group.state),
            };
        });

        groups.forEach((group) => {
            group.text = renderGroupText(group, base);
        });
        return groups;
    }

    function dominantState(hours) {
        if (!hours.length) {
            return null;
        }
        // Base = early/prevailing conditions so extending validity does not flip the
        // mean line when later clearer or worse hours appear; those become change groups.
        const earlyCount = Math.max(3, Math.min(hours.length, 6));
        const earlyHours = hours.slice(0, earlyCount);
        const scored = earlyHours.map((hour) => {
            let score = 0;
            if (hour.cavok) score -= 5;
            score += (hour.weather || []).length * 3;
            score += hour.visM < 5000 ? 2 : 0;
            score += (hour.clouds || []).some((c) => c.amount === 'BKN' || c.amount === 'OVC') ? 1 : 0;
            return { hour, score };
        });
        scored.sort((a, b) => a.score - b.score || a.hour.validTime - b.hour.validTime);
        return scored[0].hour;
    }

    function worstState(hours) {
        if (!hours.length) {
            return null;
        }
        const scored = hours.map((hour) => {
            let score = 0;
            score += (hour.weather || []).length * 4;
            if ((hour.weather || []).includes('TSRA')) score += 6;
            if ((hour.weather || []).includes('FG') || (hour.weather || []).includes('FZFG')) score += 8;
            else if ((hour.weather || []).includes('BR')) score += 5;
            if ((hour.weather || []).includes('SHRA')) score += 5;
            else if ((hour.weather || []).includes('RA') || (hour.weather || []).includes('SN')) score += 4;
            else if ((hour.weather || []).includes('DZ')) score += 2;
            // Prefer denser fog categories when choosing the PROB representative hour.
            if (Number.isFinite(hour.fogCat)) score += hour.fogCat * 2;
            if (Number.isFinite(hour.freezingFogCat)) score += hour.freezingFogCat * 2;
            score += hour.visM < 1000 ? 5 : hour.visM < 3000 ? 3 : hour.visM < 6000 ? 1 : 0;
            return { hour, score };
        });
        scored.sort((a, b) => b.score - a.score || a.hour.validTime - b.hour.validTime);
        return scored[0].hour;
    }

    function contiguousRuns(flags) {
        const runs = [];
        let start = null;
        flags.forEach((flag, index) => {
            if (flag && start == null) {
                start = index;
            }
            if ((!flag || index === flags.length - 1) && start != null) {
                const end = flag && index === flags.length - 1 ? index : index - 1;
                if (end >= start) {
                    runs.push({ start, end, length: end - start + 1 });
                }
                start = null;
            }
        });
        return runs;
    }

    function pushTempoLikeGroup(groups, {
        slice,
        state,
        base,
        total,
        validityEnd,
        useProb,
        forceProbTempo = false,
        // When false, PROB period end may extend past TAF validity (foresight).
        clampPeriodToValidity = true,
    }) {
        const hasStorm = slice.some(hourHasTs);
        const hasFog = sliceHasFog(slice);
        // Cloud/vis TEMPO still needs tempo-eligible conditions; storm/fog PROB does not.
        if (!hasStorm && !hasFog && !forceProbTempo && !tempoEligible(state)) {
            return;
        }
        if (slice.length < THRESHOLDS.tempoMinHours) {
            return;
        }
        const periodClamp = clampPeriodToValidity ? validityEnd : null;
        const period = formatPeriod(
            slice[0].validTime,
            slice[slice.length - 1].validTime,
            periodClamp,
        );
        if (!period) {
            return;
        }
        // Foresight PROB must still begin inside the published validity.
        if (
            !clampPeriodToValidity
            && validityEnd instanceof Date
            && period.startMs >= validityEnd.getTime()
        ) {
            return;
        }
        const snapped = withTempoSnappedClouds(state);
        const fraction = slice.length / total;
        const stormProb = hasStorm || forceProbTempo;
        // Fog/storm PROB is important guidance — never drop it just because the
        // spell covers most of a short validity. TEMPO cloud/vis still capped.
        if (!hasFog && !stormProb && fraction > THRESHOLDS.tempoMaxFraction) {
            return;
        }
        const intermittent = slice.length <= Math.max(3, Math.floor(total * 0.4));
        // FG/BR/FZFG → bare PROB (never PROB TEMPO). Storms → PROB TEMPO.
        if (hasFog && !hasStorm) {
            const kind = (useProb && intermittent && slice.length <= THRESHOLDS.prob40MinHours)
                ? 'PROB40'
                : 'PROB30';
            const windGroup = null;
            const fogBiased = withFogProbBias(snapped);
            const body = formatConditionBody(fogBiased, {
                windGroup,
                allowTsra: false,
                holdingStyle: true,
            });
            groups.push({
                kind,
                bareProb: true,
                state: fogBiased,
                windGroup,
                startMs: period.startMs,
                endExclusiveMs: period.endExclusiveMs,
                sortKey: period.startMs,
                text: `${kind} ${period.text} ${body}`,
            });
            return;
        }
        // TSRA is PROB-only (PROB TEMPO). Never emit TSRA on a plain TEMPO line.
        const asProbTempo = stormProb;
        const kind = asProbTempo
            ? (intermittent && slice.length <= THRESHOLDS.prob40MinHours ? 'PROB40' : 'PROB30')
            : (!hasStorm ? 'TEMPO' : null);
        if (!kind) {
            return;
        }
        const isProb = kind.startsWith('PROB');
        const stateForGroup = kind === 'TEMPO'
            ? withTempoSnappedClouds(enrichTempoStateFromSlice(snapped, slice))
            : snapped;
        const windGroup = kind === 'TEMPO'
            ? null
            : resolveChangeGroupWind(stateForGroup, base, { isProb });
        const body = formatConditionBody(stateForGroup, {
            windGroup,
            allowTsra: isProb && hasStorm,
            holdingStyle: true,
        });
        groups.push({
            kind,
            bareProb: false,
            state: stateForGroup,
            windGroup,
            startMs: period.startMs,
            endExclusiveMs: period.endExclusiveMs,
            sortKey: period.startMs,
            text: `${kind === 'TEMPO' ? 'TEMPO' : `${kind} TEMPO`} ${period.text} ${body}`,
        });
    }

    function renderGroupText(group, base) {
        const period = `${formatDdhh(new Date(group.startMs))}/${formatDdhh(new Date(group.endExclusiveMs))}`;
        if (group.kind === 'FM') {
            return `FM${formatDdhhmm(new Date(group.startMs))} ${formatConditionBody(group.state, {
                allowTsra: false,
                allowRaDz: false,
                meanStyle: true,
                requireNsw: group.requireNsw === true,
            })}`;
        }
        if (group.kind === 'BECMG') {
            return `BECMG ${period} ${formatConditionBody(group.state, {
                allowTsra: false,
                allowRaDz: false,
                meanStyle: true,
                requireNsw: group.requireNsw === true,
            })}`;
        }
        if (group.kind === 'TEMPO') {
            return `TEMPO ${period} ${formatConditionBody(group.state, {
                windGroup: null,
                allowTsra: false,
                holdingStyle: true,
            })}`;
        }
        const bareProb = group.bareProb || hourHasFog(group.state);
        const hasStorm = hourHasTs(group.state);
        const state = bareProb ? withFogProbBias(group.state) : group.state;
        const windGroup = bareProb
            ? null
            : resolveChangeGroupWind(state, base, {
                isProb: true,
                refMean: group.stormRefMean || base,
            });
        group.state = state;
        group.windGroup = windGroup;
        group.bareProb = bareProb;
        const prefix = bareProb ? group.kind : `${group.kind} TEMPO`;
        return `${prefix} ${period} ${formatConditionBody(state, {
            windGroup,
            allowTsra: !bareProb && hasStorm,
            holdingStyle: true,
        })}`;
    }

    /** Stamp storm PROB winds so they clear the active FM/BECMG mean by ≥delta. */
    function applyStormWindsVsActiveMean(groups, headerBase) {
        const means = (groups || []).filter(isMeanChangeGroup);
        return (groups || []).map((group) => {
            if (
                (group.kind !== 'PROB30' && group.kind !== 'PROB40')
                || !hourHasTs(group.state)
            ) {
                return group;
            }
            const next = {
                ...group,
                stormRefMean: activeMeanStateAt(headerBase, means, group.startMs),
            };
            next.windGroup = resolveChangeGroupWind(next.state, headerBase, {
                isProb: true,
                refMean: next.stormRefMean,
            });
            next.text = renderGroupText(next, headerBase);
            return next;
        });
    }

    function gapHoursBetween(prevEndExclusiveMs, nextStartMs) {
        return Math.round((nextStartMs - prevEndExclusiveMs) / (60 * 60 * 1000));
    }

    function sameHoldingFamily(a, b) {
        const sameKind = (a.kind === 'TEMPO' && b.kind === 'TEMPO')
            || ((a.kind === 'PROB30' || a.kind === 'PROB40')
                && (b.kind === 'PROB30' || b.kind === 'PROB40'));
        if (!sameKind) {
            return false;
        }
        // Never merge storm PROB into fog/cloud PROB (or vice versa) — that was
        // stretching TSRA periods across earlier low-cloud/fog spells.
        return holdingClass(a.state) === holdingClass(b.state);
    }

    /** Cloud ↔ precip TEMPOs are one deterioration story for gap risk (not merge family). */
    function cloudPrecipTempoPair(a, b) {
        if (a?.kind !== 'TEMPO' || b?.kind !== 'TEMPO') {
            return false;
        }
        const classA = holdingClass(a.state);
        const classB = holdingClass(b.state);
        return (classA === 'cloud' || classA === 'precip')
            && (classB === 'cloud' || classB === 'precip');
    }

    /** Close a short hole by extending the earlier holding up to the next start. */
    function abutHoldingGap(prev, next, base) {
        if (!prev || !next || next.startMs <= prev.endExclusiveMs) {
            return;
        }
        prev.endExclusiveMs = next.startMs;
        prev.text = renderGroupText(prev, base);
    }

    function mergeHoldingPair(prev, group, base) {
        prev.state = withTempoSnappedClouds(mergeTempoStates(prev.state, group.state));
        prev.endExclusiveMs = group.endExclusiveMs;
        if (prev.kind.startsWith('PROB') || group.kind.startsWith('PROB')) {
            prev.kind = (prev.kind === 'PROB30' || group.kind === 'PROB30')
                ? 'PROB30'
                : 'PROB40';
            prev.bareProb = Boolean(prev.bareProb || group.bareProb || hourHasFog(prev.state));
        }
        prev.text = renderGroupText(prev, base);
    }

    /**
     * Bridge short gaps between similar TEMPO / PROB TEMPO holdings and merge
     * into fewer, longer groups. 1-hour holes in the cloud/precip story are
     * always closed (merge when similar; otherwise abut so wording stays stepped);
     * overnight 1–2 h cloud/fog gaps are treated as risky unless a regime change;
     * resistance (from line count) widens bridging and forces more merges.
     */
    function coalesceSimilarHoldings(groups, base, resistance = 0, lat = null, lon = null) {
        const maxGap = bridgeGapLimit(resistance);
        const overnightMax = THRESHOLDS.overnightBridgeMaxGapHours || 2;
        const riskyGap = THRESHOLDS.tempoRiskyGapHours || 1;
        const out = [];
        groups.forEach((group) => {
            const prev = out[out.length - 1];
            if (!prev || !sameHoldingFamily(prev, group)) {
                // e.g. OVC010 then SHRA OVC005 — don't leave a 1 h hole between them.
                if (prev && cloudPrecipTempoPair(prev, group)) {
                    const crossGap = gapHoursBetween(prev.endExclusiveMs, group.startMs);
                    if (crossGap > 0 && crossGap <= riskyGap) {
                        abutHoldingGap(prev, group, base);
                    }
                }
                out.push({ ...group });
                return;
            }
            const gap = gapHoursBetween(prev.endExclusiveMs, group.startMs);
            const overnightGap = Number.isFinite(lat)
                && Number.isFinite(lon)
                && gap > 0
                && gap <= overnightMax
                && gapIsOvernight(lat, lon, prev.endExclusiveMs, group.startMs);
            const effectiveMaxGap = overnightGap ? Math.max(maxGap, overnightMax) : maxGap;
            if (gap < 0 || gap > effectiveMaxGap) {
                out.push({ ...group });
                return;
            }
            const bandDiff = cloudBandDiff(prev, group);
            const maxBand = overnightGap
                ? Math.max(1, maxBandDiffForMerge(resistance, gap))
                : maxBandDiffForMerge(resistance, gap);
            const classA = holdingClass(prev.state);
            const classB = holdingClass(group.state);
            const cloudOrFog = (classA === 'cloud' || classA === 'fog')
                && (classB === 'cloud' || classB === 'fog');
            // Overnight: close 1–2 h holes between low cloud / fog holdings.
            const overnightRisky = overnightGap
                && cloudOrFog
                && classA !== 'storm'
                && classB !== 'storm'
                && bandDiff <= 1;
            const precipA = primaryPrecipCode(prev.state);
            const precipB = primaryPrecipCode(group.state);
            const precipMismatch = Boolean(precipA && precipB && precipA !== precipB);
            // 1 h holes: allow a 2-band step (e.g. OVC010 → OVC005) so the gap closes.
            const riskyBandLimit = gap <= riskyGap ? Math.max(maxBand, 2) : maxBand;
            const riskyShortGap = !precipMismatch
                && gap <= riskyGap
                && bandDiff <= riskyBandLimit
                && classA !== 'storm'
                && classB !== 'storm'
                && classA !== 'fog'
                && classB !== 'fog';
            const similar = similarHoldings(prev, group, { maxBandDiff: maxBand });
            // High resistance: prefer full merge even across modest band steps.
            const forceSimplify = !precipMismatch
                && resistance >= 0.45
                && bandDiff <= maxBand
                && similarHoldings(prev, group, { maxBandDiff: maxBand });
            if (riskyShortGap || overnightRisky || similar || forceSimplify) {
                mergeHoldingPair(prev, group, base);
                return;
            }
            // Still too risky to leave a 1 h hole — abut without blending wording.
            if (
                gap > 0
                && gap <= riskyGap
                && classA !== 'storm'
                && classB !== 'storm'
                && classA !== 'fog'
                && classB !== 'fog'
            ) {
                abutHoldingGap(prev, group, base);
            }
            out.push({ ...group });
        });
        return out;
    }

    /**
     * Iteratively simplify holdings using line-count resistance. Header + base
     * count as 2 lines; each change group is another line.
     */
    /** Drop PROB/TEMPO holdings fully contained inside a longer same-family holding. */
    function removeContainedHoldings(groups) {
        return groups.filter((group, index) => {
            if (isMeanChangeGroup(group)) {
                return true;
            }
            return !groups.some((other, otherIndex) => {
                if (otherIndex === index || !sameHoldingFamily(group, other)) {
                    return false;
                }
                const otherDur = other.endExclusiveMs - other.startMs;
                const dur = group.endExclusiveMs - group.startMs;
                return other.startMs <= group.startMs
                    && other.endExclusiveMs >= group.endExclusiveMs
                    && otherDur > dur;
            });
        });
    }

    function sameMeanFamily(a, b) {
        return isMeanChangeGroup(a)
            && isMeanChangeGroup(b)
            && (a.meanPriority || 'optional') === (b.meanPriority || 'optional');
    }

    function mergeMeanPair(prev, group, base) {
        // Keep later regime state; extend span for BECMG windows.
        prev.state = group.state || prev.state;
        prev.requireNsw = Boolean(prev.requireNsw || group.requireNsw);
        prev.meanPriority = prev.meanPriority === 'mandatory' || group.meanPriority === 'mandatory'
            ? 'mandatory'
            : (prev.meanPriority || group.meanPriority || 'optional');
        if (prev.kind === 'BECMG' || group.kind === 'BECMG') {
            prev.kind = 'BECMG';
            prev.startMs = Math.min(prev.startMs, group.startMs);
            prev.endExclusiveMs = Math.max(
                prev.endExclusiveMs || prev.startMs,
                group.endExclusiveMs || group.startMs,
            );
            // Clamp BECMG window to 1–2 hours.
            const maxWindowMs = 2 * 60 * 60 * 1000;
            if (prev.endExclusiveMs - prev.startMs > maxWindowMs) {
                prev.startMs = prev.endExclusiveMs - maxWindowMs;
            }
        } else {
            prev.kind = 'FM';
            prev.startMs = group.startMs;
            prev.endExclusiveMs = group.endExclusiveMs;
        }
        prev.sortKey = prev.startMs;
        prev.text = renderGroupText(prev, base);
    }

    /**
     * Merge nearby same-priority mean lines.
     * By default only merges identical regimes; forceNearby also merges distinct
     * optional means that sit within maxGapHours (line-pressure easing).
     */
    function coalesceSimilarMeanGroups(groups, base, maxGapHours = 3, { forceNearby = false } = {}) {
        const out = [];
        const sorted = groups.slice().sort((a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey);
        sorted.forEach((group) => {
            const prev = out[out.length - 1];
            if (!prev || !sameMeanFamily(prev, group)) {
                out.push({ ...group });
                return;
            }
            const gap = gapHoursBetween(
                Math.max(prev.endExclusiveMs || prev.startMs, prev.startMs),
                group.startMs,
            );
            const change = classifyMeanChange(prev.state, group.state);
            if (change === 'mandatory') {
                out.push({ ...group });
                return;
            }
            const similar = change == null
                || (forceNearby && prev.meanPriority === 'optional' && gap <= maxGapHours);
            if (gap < 0 || gap > maxGapHours || !similar) {
                out.push({ ...group });
                return;
            }
            mergeMeanPair(prev, group, base);
        });
        return out;
    }

    /** Keep prior mean body; take the stronger wind from a dropped late mean. */
    function absorbStrongerMeanWind(prevState, droppedState) {
        if (!prevState) {
            return droppedState;
        }
        if (!droppedState) {
            return prevState;
        }
        const prevKt = prevState.windKt || 0;
        const nextKt = droppedState.windKt || 0;
        const useNextDir = nextKt >= prevKt;
        return normalizeMeanState({
            ...prevState,
            windKt: Math.max(prevKt, nextKt),
            gustKt: Math.max(prevState.gustKt || 0, droppedState.gustKt || 0),
            windDir: useNextDir ? droppedState.windDir : prevState.windDir,
            weather: prevState.weather || [],
            clouds: prevState.clouds || [],
            cavok: prevState.cavok,
        }, { liftClouds: false });
    }

    /**
     * Drop FM/BECMG at/after validity end (they never apply). Absorb late low-value
     * wind/cloud pickups into the prior mean so mid-TAF story lines (e.g. SHRA→RA)
     * win over end-of-TAF wind increases.
     */
    function pruneLateAndExpiredMeanGroups(groups, validityEndMs) {
        if (!groups?.length || !Number.isFinite(validityEndMs)) {
            return groups || [];
        }
        const byStart = (a, b) => a.startMs - b.startMs || (a.sortKey || 0) - (b.sortKey || 0);
        let list = groups
            .filter((group) => !isMeanChangeGroup(group) || group.startMs < validityEndMs)
            .map((group) => ({ ...group, state: group.state ? { ...group.state } : group.state }))
            .sort(byStart);
        const lateMs = validityEndMs - ((THRESHOLDS.meanLateWindowHours || 3) * 60 * 60 * 1000);
        for (let index = list.length - 1; index >= 1; index -= 1) {
            const group = list[index];
            if (!isMeanChangeGroup(group) || group.startMs < lateMs) {
                continue;
            }
            // Keep holding-driven story edges even if late.
            if (
                group.meanSource === 'holding-onset'
                || group.meanSource === 'holding-transition'
                || group.meanSource === 'holding-cessation'
            ) {
                continue;
            }
            const prev = list[index - 1];
            if (!isMeanChangeGroup(prev)) {
                continue;
            }
            prev.state = absorbStrongerMeanWind(prev.state, group.state);
            list.splice(index, 1);
        }
        return list;
    }

    /**
     * Drop optional mean lines until at/under soft budget.
     * Keep holding-transition story lines longer than other optionals / late means.
     */
    function dropOptionalMeanGroups(groups, softBudget, otherLineCount = 0, validityEndMs = null) {
        let current = groups.map((group) => ({ ...group }));
        const dropScore = (group) => {
            // Higher = drop sooner.
            let score = 0;
            if (group.meanSource === 'holding-transition') {
                score -= 40;
            }
            if (Number.isFinite(validityEndMs) && group.startMs >= validityEndMs - ((THRESHOLDS.meanLateWindowHours || 3) * 60 * 60 * 1000)) {
                score += 50;
            }
            return score;
        };
        while (2 + otherLineCount + current.length > softBudget) {
            const optionalIndexes = current
                .map((group, index) => ({ group, index }))
                .filter((entry) => isMeanChangeGroup(entry.group) && entry.group.meanPriority === 'optional');
            if (!optionalIndexes.length) {
                break;
            }
            optionalIndexes.sort((a, b) => (
                dropScore(b.group) - dropScore(a.group)
                || b.group.startMs - a.group.startMs
            ));
            current.splice(optionalIndexes[0].index, 1);
        }
        return current;
    }

    function simplifyHoldingsForLineBudget(groups, base, validityHours, lat = null, lon = null) {
        const { soft } = validityLineBudget(validityHours);
        let current = groups.map((group) => ({ ...group }));
        for (let pass = 0; pass < 8; pass += 1) {
            const lineCount = 2 + current.length;
            const resistance = tafLineResistance(lineCount, validityHours);
            const byStart = (a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey;
            const overSoft = lineCount > soft;
            const optionalMeans = coalesceSimilarMeanGroups(
                current.filter((group) => isMeanChangeGroup(group) && group.meanPriority === 'optional').sort(byStart),
                base,
                resistance >= 0.35 ? 6 : 3,
                { forceNearby: overSoft || resistance >= 0.35 },
            );
            const mandatoryMeans = current
                .filter((group) => isMeanChangeGroup(group) && group.meanPriority !== 'optional')
                .sort(byStart);
            // Line pressure may merge TEMPOs; PROB groups only coalesce like-with-like
            // at low resistance so fog/storm PROB is not squeezed out of short TAFs.
            const tempoGroups = coalesceSimilarHoldings(
                current.filter((group) => group.kind === 'TEMPO').sort(byStart),
                base,
                resistance,
                lat,
                lon,
            );
            const probGroups = coalesceSimilarHoldings(
                current.filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40').sort(byStart),
                base,
                Math.min(resistance, 0.15),
                lat,
                lon,
            );
            let next = removeContainedHoldings([
                ...optionalMeans,
                ...mandatoryMeans,
                ...tempoGroups,
                ...probGroups,
            ]);

            // After optional merge, drop leftover optionals if still over soft budget.
            if (2 + next.length > soft) {
                next = dropOptionalMeanGroups(next, soft);
            }

            // Equal priority: merge close mandatory means + holdings further.
            if (2 + next.length > soft) {
                const mandMerged = coalesceSimilarMeanGroups(
                    next.filter((group) => isMeanChangeGroup(group) && group.meanPriority === 'mandatory').sort(byStart),
                    base,
                    4,
                    { forceNearby: false },
                );
                const stillOptional = next.filter((group) => (
                    isMeanChangeGroup(group) && group.meanPriority === 'optional'
                ));
                const tempos = coalesceSimilarHoldings(
                    next.filter((group) => group.kind === 'TEMPO').sort(byStart),
                    base,
                    Math.max(resistance, 0.5),
                    lat,
                    lon,
                );
                const probs = coalesceSimilarHoldings(
                    next.filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40').sort(byStart),
                    base,
                    Math.min(Math.max(resistance, 0.25), 0.35),
                    lat,
                    lon,
                );
                next = removeContainedHoldings([...stillOptional, ...mandMerged, ...tempos, ...probs]);
            }

            next.forEach((group) => {
                group.text = renderGroupText(group, base);
            });
            const unchanged = next.length === current.length
                && next.every((group, index) => group.text === current[index].text);
            current = next;
            if (unchanged || lineCount <= soft) {
                // Still run one coalesce pass to close risky 1h gaps at/under target.
                if (pass === 0 && lineCount <= soft) {
                    continue;
                }
                break;
            }
        }
        return current;
    }

    /** Fill short gaps between similar tempo-eligible runs before grouping. */
    function bridgeSimilarFlagRuns(flags, hours, lat = null, lon = null) {
        const bridged = flags.slice();
        const overnightMax = THRESHOLDS.overnightBridgeMaxGapHours || 2;
        let changed = true;
        while (changed) {
            changed = false;
            const runs = contiguousRuns(bridged);
            for (let index = 0; index < runs.length - 1; index += 1) {
                const left = runs[index];
                const right = runs[index + 1];
                const gap = right.start - left.end - 1;
                if (gap <= 0) {
                    continue;
                }
                const gapStartMs = hours[left.end].validTime.getTime() + (60 * 60 * 1000);
                const gapEndMs = hours[right.start].validTime.getTime();
                const overnightGap = Number.isFinite(lat)
                    && Number.isFinite(lon)
                    && gap <= overnightMax
                    && gapIsOvernight(lat, lon, gapStartMs, gapEndMs);
                const maxGap = overnightGap
                    ? Math.max(THRESHOLDS.tempoBridgeMaxGapHours, overnightMax)
                    : THRESHOLDS.tempoBridgeMaxGapHours;
                if (gap > maxGap) {
                    continue;
                }
                const gapHours = hours.slice(left.end + 1, right.start);
                // Never bridge across thunderstorm hours — that re-absorbs TSRA
                // into a surrounding low-cloud TEMPO and stretches storm PROB.
                if (gapHours.some(hourHasTs)) {
                    continue;
                }
                const leftState = worstState(hours.slice(left.start, left.end + 1));
                const rightState = worstState(hours.slice(right.start, right.end + 1));
                // Overnight: also refuse to bridge across a definitive regime change.
                if (overnightGap && hasDefinitiveRegimeChange(leftState, gapHours)) {
                    continue;
                }
                if (!similarHoldings(
                    { state: leftState },
                    { state: rightState },
                    { maxBandDiff: 1 },
                )) {
                    continue;
                }
                for (let fill = left.end + 1; fill < right.start; fill += 1) {
                    bridged[fill] = true;
                }
                changed = true;
                break;
            }
        }
        return bridged;
    }

    /**
     * Overnight/predawn low cloud & fog: hold through to sunrise when the model
     * clears early without a definitive regime change (frontal / mesoscale shift).
     */
    function extendOvernightHoldingsTowardSunrise(groups, hours, base, lat, lon, validityEnd) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !groups?.length) {
            return groups;
        }
        const validityEndMs = validityEnd instanceof Date
            ? validityEnd.getTime()
            : Number.POSITIVE_INFINITY;
        const maxExtendH = THRESHOLDS.overnightExtendMaxHours || 4;
        return groups.map((group) => {
            if (isMeanChangeGroup(group)) {
                return group;
            }
            const cls = holdingClass(group.state);
            if (cls !== 'cloud' && cls !== 'fog') {
                return group;
            }
            const lastHourMs = group.endExclusiveMs - (60 * 60 * 1000);
            const endPhase = diurnalPhaseAt(lat, lon, new Date(lastHourMs));
            const midPhase = diurnalPhaseAt(
                lat,
                lon,
                new Date((group.startMs + group.endExclusiveMs) / 2),
            );
            if (!isOvernightPhase(endPhase) && !isOvernightPhase(midPhase)) {
                return group;
            }
            const sunriseMs = nextSunriseAfter(lat, lon, group.startMs);
            if (!Number.isFinite(sunriseMs) || sunriseMs <= group.endExclusiveMs) {
                return group;
            }
            const extendTo = Math.min(sunriseMs, validityEndMs);
            const hoursToSunrise = (extendTo - group.endExclusiveMs) / (60 * 60 * 1000);
            if (hoursToSunrise <= 0 || hoursToSunrise > maxExtendH) {
                return group;
            }
            const gapHours = hours.filter((hour) => {
                const t = hour.validTime.getTime();
                return t >= group.endExclusiveMs && t < extendTo;
            });
            if (hasDefinitiveRegimeChange(group.state, gapHours)) {
                return group;
            }
            const extended = {
                ...group,
                endExclusiveMs: extendTo,
            };
            extended.text = renderGroupText(extended, base);
            return extended;
        });
    }

    /**
     * Afternoon/evening: wave off fleeting dry low-cloud TEMPOs (model noise).
     * Fog, precip, and storm-linked holdings are kept.
     */
    function waveOffDaytimeFleetingCloudTempos(groups, lat, lon) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !groups?.length) {
            return groups;
        }
        const minHours = THRESHOLDS.daytimeCloudTempoMinHours || 3;
        return groups.filter((group) => {
            if (group.kind !== 'TEMPO' || !holdingIsDryLowCloud(group.state)) {
                return true;
            }
            const durHours = Math.round(
                (group.endExclusiveMs - group.startMs) / (60 * 60 * 1000),
            );
            if (durHours >= minHours) {
                return true;
            }
            const mid = new Date((group.startMs + group.endExclusiveMs) / 2);
            const phase = diurnalPhaseAt(lat, lon, mid);
            // Optimistic bias in afternoon / pre-sunset evening only.
            return !isOptimisticCloudPhase(phase);
        });
    }

    /** Close short holes between storm hours before building PROB spells. */
    function bridgeStormFlagRuns(flags) {
        const bridged = flags.slice();
        const maxGap = THRESHOLDS.stormBridgeMaxGapHours;
        let changed = true;
        while (changed) {
            changed = false;
            const runs = contiguousRuns(bridged);
            for (let index = 0; index < runs.length - 1; index += 1) {
                const left = runs[index];
                const right = runs[index + 1];
                const gap = right.start - left.end - 1;
                if (gap <= 0 || gap > maxGap) {
                    continue;
                }
                for (let fill = left.end + 1; fill < right.start; fill += 1) {
                    bridged[fill] = true;
                }
                changed = true;
                break;
            }
        }
        return bridged;
    }

    /**
     * Hours that may back-extend a TSRA PROB (SHRA / convective already underway).
     * Does not invent storms from dry low cloud alone.
     */
    function stormProbLeadInEligible(hour) {
        if (!hour || hourHasTs(hour)) {
            return false;
        }
        if (hourHasFog(hour) || fogPolicyCategory(hour) >= 1) {
            return false;
        }
        const wx = hour.weather || [];
        if (wx.includes('SHRA') || wx.includes('RA') || wx.includes('SN')) {
            return true;
        }
        if (omShowerWeather(hour) || isShoweryPrecip(hour)) {
            return true;
        }
        const cape = hour.capeJkg || 0;
        if (
            cape >= (THRESHOLDS.capeShowerMinJkg || 150)
            && (precipAmountMm(hour) > 0 || convectivePrecipMm(hour) > 0)
        ) {
            return true;
        }
        return false;
    }

    /**
     * Storm PROB from TSRA hours, with a short SHRA/convective lead-in so map-early
     * cells are not late. Dry low-cloud alone never extends the spell.
     */
    function pushStormProbGroups(groups, hours, base, total, validityEnd) {
        const stormFlags = bridgeStormFlagRuns(hours.map(hourHasTs));
        const maxLead = Math.max(0, THRESHOLDS.stormProbLeadInHours || 0);
        contiguousRuns(stormFlags).forEach((run) => {
            if (run.length < THRESHOLDS.stormProbMinHours) {
                return;
            }
            let start = run.start;
            while (start > 0 && (run.start - start) < maxLead) {
                if (!stormProbLeadInEligible(hours[start - 1])) {
                    break;
                }
                start -= 1;
            }
            const slice = hours.slice(start, run.end + 1);
            const worst = worstState(slice) || slice[0];
            // Peak mean/gust / precip over the whole storm spell — not the worst-wx hour alone.
            let peakPrecipMm = 0;
            let peakConvectiveMm = 0;
            slice.forEach((hour) => {
                peakPrecipMm = Math.max(peakPrecipMm, precipAmountMm(hour));
                peakConvectiveMm = Math.max(peakConvectiveMm, convectivePrecipMm(hour));
            });
            const state = {
                ...peakWindHourFromSlice(slice, worst),
                peakPrecipMm,
                peakConvectiveMm,
            };
            pushTempoLikeGroup(groups, {
                slice,
                state,
                base,
                total,
                validityEnd,
                useProb: true,
                forceProbTempo: true,
                clampPeriodToValidity: false,
            });
        });
    }

    /**
     * Fog/mist PROB from policy fog hours (incl. foresight). Extends the start
     * back through contiguous low-cloud lead-in so short TAFs still show the
     * upcoming FG spell that a longer validity would publish.
     */
    function pushFogProbGroups(groups, hours, base, total, validityEnd) {
        const fogFlags = hours.map((hour) => (
            hourHasFog(hour) || fogPolicyCategory(hour) >= 1
        ));
        contiguousRuns(fogFlags).forEach((run) => {
            let start = run.start;
            while (start > 0) {
                const prev = hours[start - 1];
                if (hourHasFog(prev) || fogPolicyCategory(prev) >= 1 || hourHasTs(prev)) {
                    break;
                }
                if (!tempoEligible(prev) || !tempoSignificantVsBase(base, prev)) {
                    break;
                }
                start -= 1;
            }
            const slice = hours.slice(start, run.end + 1);
            if (slice.length < THRESHOLDS.prob30MinHours) {
                return;
            }
            if (validityEnd instanceof Date && slice[0].validTime.getTime() >= validityEnd.getTime()) {
                return;
            }
            const worst = worstState(slice) || slice[0];
            const repCat = fogProbRepresentativeCategory(slice);
            const state = withFogProbBias(applyFogProbCategory(worst, repCat));
            pushTempoLikeGroup(groups, {
                slice,
                state,
                base,
                total,
                validityEnd,
                useProb: true,
                clampPeriodToValidity: false,
            });
        });
    }

    function buildChangeGroups(hours, validityEnd, {
        validityHourCount = null,
        lat = null,
        lon = null,
    } = {}) {
        if (hours.length < 2) {
            return [];
        }
        const publishedCount = Number.isFinite(validityHourCount)
            ? Math.max(1, Math.min(hours.length, validityHourCount))
            : hours.length;
        const publishedHours = hours.slice(0, publishedCount);
        // Significance base uses lifted cloud so lower ceilings become TEMPO/PROB
        // holdings; display mean only keeps the lift when those holdings exist.
        const base = normalizeMeanState(
            dominantState(publishedHours) || dominantState(hours),
            { liftClouds: true },
        );
        const groups = [];
        // TEMPO/FM only from published validity — exclude storm/fog so those
        // become dedicated PROB lines (with foresight) instead of replacing TEMPO.
        const worseFlags = bridgeSimilarFlagRuns(
            publishedHours.map((hour) => (
                tempoSignificantVsBase(base, hour)
                && !hourHasTs(hour)
                && !hourHasFog(hour)
                && fogPolicyCategory(hour) < 1
            )),
            publishedHours,
            lat,
            lon,
        );
        const runs = contiguousRuns(worseFlags);
        const total = publishedHours.length;

        runs.forEach((run) => {
            const slice = publishedHours.slice(run.start, run.end + 1);
            if (!slice.length) {
                return;
            }
            const state = worstState(slice) || slice[0];
            pushTempoLikeGroup(groups, {
                slice,
                state,
                base,
                total,
                validityEnd,
                useProb: true,
                clampPeriodToValidity: true,
            });
        });

        // Mean FM/BECMG from sustained regime changes (mandatory + optional).
        const meanGroups = buildMeanChangeGroups(publishedHours);
        meanGroups.forEach((group) => {
            group.text = renderGroupText(group, base);
            groups.push(group);
        });

        // Fog / storm PROB use published + foresight hours; period may run past validity.
        pushFogProbGroups(groups, hours, base, hours.length, validityEnd);
        pushStormProbGroups(groups, hours, base, hours.length, validityEnd);

        // Coalesce with line-count + validity-length resistance (published span).
        const validityHours = Math.max(
            1,
            Math.round(
                (publishedHours[publishedHours.length - 1].validTime - publishedHours[0].validTime)
                / (60 * 60 * 1000),
            ) + 1,
        );
        const simplified = simplifyHoldingsForLineBudget(groups, base, validityHours, lat, lon);
        // Hierarchy first, then one more coalesce so TEMPOs that land on nearby
        // bands (e.g. BKN010 / BKN012 under FEW025) can merge into one line.
        enforceCloudCeilingHierarchy(base, simplified);
        const byStart = (a, b) => a.startMs - b.startMs || a.sortKey - b.sortKey;
        let tempoMerged = coalesceSimilarHoldings(
            simplified.filter((group) => group.kind === 'TEMPO').sort(byStart),
            base,
            0.5,
            lat,
            lon,
        ).filter((group) => {
            const durHours = Math.round((group.endExclusiveMs - group.startMs) / (60 * 60 * 1000));
            return durHours >= THRESHOLDS.tempoMinHours;
        });
        // Drop any remaining single-hour storm PROB (unrealistically specific).
        let probGroups = simplified
            .filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40')
            .filter((group) => {
                if (!hourHasTs(group.state)) {
                    return true;
                }
                const durHours = Math.round((group.endExclusiveMs - group.startMs) / (60 * 60 * 1000));
                return durHours >= THRESHOLDS.stormProbMinHours;
            })
            .sort(byStart);
        // Storm PROB ⇒ coincident SHRA TEMPO (extend/enrich nearby cloud TEMPO).
        alignTempoWithStormProb(tempoMerged, probGroups, base);
        // Drop any 1h TEMPO left after storm alignment.
        for (let index = tempoMerged.length - 1; index >= 0; index -= 1) {
            const durHours = Math.round(
                (tempoMerged[index].endExclusiveMs - tempoMerged[index].startMs) / (60 * 60 * 1000),
            );
            if (durHours < THRESHOLDS.tempoMinHours) {
                tempoMerged.splice(index, 1);
            }
        }
        // Diurnal bias: overnight hold to sunrise; afternoon wave off fleeting dry cloud.
        let meanKept = collapseSameBodyMeanGroups(
            simplified.filter(isMeanChangeGroup).sort(byStart),
        );
        const afterExtend = extendOvernightHoldingsTowardSunrise(
            [...meanKept, ...tempoMerged, ...probGroups],
            hours,
            base,
            lat,
            lon,
            validityEnd,
        );
        tempoMerged = waveOffDaytimeFleetingCloudTempos(
            afterExtend.filter((group) => group.kind === 'TEMPO'),
            lat,
            lon,
        );
        // Re-coalesce overnight after sunrise extensions close neighbouring gaps.
        tempoMerged = coalesceSimilarHoldings(tempoMerged.sort(byStart), base, 0.5, lat, lon);
        probGroups = coalesceSimilarHoldings(
            afterExtend
                .filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40')
                .sort(byStart),
            base,
            0.15,
            lat,
            lon,
        );
        // Re-align after diurnal/coalesce so SHRA still covers the final storm window.
        alignTempoWithStormProb(tempoMerged, probGroups, base);
        // Heavier SHRA TEMPO ceilings step below following milder RA TEMPOs.
        enforcePrecipTempoCloudSteps(tempoMerged);
        // Dry (non-fog) low-cloud TEMPOs: don't publish fog-depth bases from bad LCL.
        sanitizeDryTempoCloudFloor(tempoMerged);
        // One shower regime TEMPO; drop dry ghosts inside it (no mid-spell FM chase).
        tempoMerged = consolidatePrecipStormRegime(tempoMerged, probGroups);
        // Holding edges → mean FM onset (-SHRA), SHRA→RA, cessation (NSW).
        const holdingMeans = buildMeanGroupsFromHoldings(base, tempoMerged, publishedHours);
        meanKept = collapseSameBodyMeanGroups(
            mergeMeanGroupsByTime([...meanKept, ...holdingMeans]),
        );
        // Holding FM owns the precip spell — drop/truncate gradual wind BECMG into it.
        meanKept = pruneWindMeansDuringPrecipSpell(meanKept, tempoMerged);
        // FM must not start inside a BECMG window.
        meanKept = resolveBecmgFmOverlaps(meanKept);
        const validityEndMs = validityEnd instanceof Date
            ? validityEnd.getTime()
            : (publishedHours[publishedHours.length - 1].validTime.getTime() + (60 * 60 * 1000));
        // Drop FM at validity end; absorb late wind pickups into the prior mean so
        // mid-TAF holding transitions (e.g. FM072200 SHRA→RA) are preferred.
        meanKept = pruneLateAndExpiredMeanGroups(meanKept, validityEndMs);
        const { soft: softLineBudget } = validityLineBudget(validityHours);
        meanKept = dropOptionalMeanGroups(
            meanKept,
            softLineBudget,
            tempoMerged.length + probGroups.length,
            validityEndMs,
        );
        meanKept = pruneInsignificantMeanGroups(meanKept, base);
        meanKept.forEach((group) => {
            group.text = renderGroupText(group, base);
        });
        // Australian-style draft blocks: FM/BECMG → TEMPO → PROB (each by start).
        // RMK / T/Q / TURB are appended later in buildDraft.
        // Hierarchy after precip stepping so TSRA sits under the lowered SHRA floor.
        const ordered = enforceCloudCeilingHierarchy(base, [
            ...meanKept.sort(byStart),
            ...tempoMerged.sort(byStart),
            ...probGroups.sort(byStart),
        ]);
        // Lift mean cloud off amendment thresholds only when a holding covers below.
        const withMeanLift = ordered.map((group) => {
            if (!isMeanChangeGroup(group)) {
                return group;
            }
            const state = applyMeanCloudLiftIfHeld(group.state, ordered);
            const next = { ...group, state };
            next.text = renderGroupText(next, base);
            return next;
        });
        // Drop marginal dry low-cloud TEMPOs before reconcile/compress invents BKN means.
        const solidDryTempo = (group) => {
            if (group.kind !== 'TEMPO') {
                return true;
            }
            if (holdingHasPrecipStorm(group.state) || hourHasFog(group.state) || tempoHasPrecip(group.state)) {
                return true;
            }
            if (!tempoHasLowCloud(group.state)) {
                return true;
            }
            return holdingAllowsBknPromotion(group.state);
        };
        let reconciled = withMeanLift.filter(solidDryTempo);
        // Never allow mean BKN/OVC ≤ coincident TEMPO — hierarchy fix (precip keeps FM story).
        reconciled = resolveMeanTempoCloudConflicts(reconciled, base);
        // cloud_br only: onset BECMG + clear BECMG. precip_storm episodes are skipped.
        reconciled = compressLowCloudEpisodeMeans(reconciled, base);
        // Re-apply ceiling stack so TSRA stays under SHRA after any reconcile/compress.
        reconciled = enforceCloudCeilingHierarchy(base, reconciled);
        // Hierarchy / compress can re-lower dry TEMPOs — restore non-fog floor.
        sanitizeDryTempoCloudFloor(
            reconciled.filter((group) => group.kind === 'TEMPO'),
            800,
        );
        // Dry low cloud: raise TEMPO to mean deck, SCT under TEMPO, FEW lead-in.
        reconciled = refineDryLowCloudMeanTempoStory(reconciled);
        // Precip/fog TEMPO + CAVOK mean → SCT at the TEMPO base.
        reconciled = alignCavokMeanWithCloudTempos(reconciled);
        // Fog/BR PROB owns low stratus — drop overlapping mean BKN006-style ceilings.
        reconciled = stripMeanBknUnderFogHoldings(reconciled);
        // Compress can invent BECMGs — ensure no FM still starts inside a BECMG window.
        let meansFixed = resolveBecmgFmOverlaps(
            reconciled.filter(isMeanChangeGroup),
        );
        meansFixed = collapseRedundantCavokMeans(meansFixed);
        // Drop header-similar CAVOK wind pickups (e.g. 25021 → BECMG 25024).
        meansFixed = pruneInsignificantMeanGroups(meansFixed, base);
        const reblocked = [
            ...meansFixed.sort(byStart),
            ...reconciled.filter((group) => group.kind === 'TEMPO').sort(byStart),
            ...reconciled.filter((group) => group.kind === 'PROB30' || group.kind === 'PROB40').sort(byStart),
        ];
        reblocked.forEach((group) => {
            group.text = renderGroupText(group, base);
        });
        // Storm PROB winds must clear the active mean (header/FM/BECMG) by ≥delta.
        const withStormWinds = applyStormWindsVsActiveMean(reblocked, base);
        const seen = new Set();
        return withStormWinds.filter((group) => {
            const key = group.text;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    function tempoHasPrecip(state) {
        return (state?.weather || []).some((code) => PRECIP_WX.has(code));
    }

    function tempoHasLowCloud(state) {
        return (state?.clouds || []).some((cloud) => (
            (cloud.amount === 'BKN' || cloud.amount === 'OVC')
            && cloud.convective !== 'CB'
        ));
    }

    function tempoStormAlignScore(tempo) {
        const wx = tempo?.state?.weather || [];
        if (wx.includes('SHRA') || wx.includes('RA') || wx.includes('SN')) {
            return 3;
        }
        if (tempoHasLowCloud(tempo.state)) {
            return 2;
        }
        if (wx.includes('DZ')) {
            return 1;
        }
        return 0;
    }

    function stormCbBaseFt(storm) {
        return cbBaseFtFromClouds(ensureTsraCbClouds(storm?.state));
    }

    /** High-based TSRA (CB above stormShraMaxCbBaseFt) — no coincident SHRA TEMPO. */
    function stormIsHighBased(storm) {
        const cbBase = stormCbBaseFt(storm);
        const maxFt = THRESHOLDS.stormShraMaxCbBaseFt || 5000;
        return Number.isFinite(cbBase) && cbBase > maxFt;
    }

    /** Peak precip rate for a storm PROB (slice max when available). */
    function stormPeakPrecipMm(storm) {
        return Math.max(
            THRESHOLDS.precipRainMm || 0.2,
            Number(storm?.state?.peakPrecipMm) || 0,
            Number(storm?.state?.peakConvectiveMm) || 0,
            precipAmountMm(storm?.state) || 0,
            convectivePrecipMm(storm?.state) || 0,
        );
    }

    /**
     * Vis for SHRA TEMPO coincident with TSRA: precip ladder from storm peak rates,
     * and for low/mid-based storms never milder than visStormShraM (default 4000).
     * Does not use TSRA 1000 m vis.
     */
    function stormCoincidentShraVisM(storm, prevVis = 9999) {
        const ladderVis = visibilityFromPrecipAmount(stormPeakPrecipMm(storm));
        let visM = Math.min(
            Number.isFinite(prevVis) ? prevVis : 9999,
            ladderVis,
        );
        if (!stormIsHighBased(storm)) {
            visM = Math.min(visM, THRESHOLDS.visStormShraM || 4000);
        }
        return visM;
    }

    /** SHRA TEMPO state covering a low/mid-based storm PROB (not TSRA vis). */
    function buildStormCoincidentShraState(storm) {
        const visM = stormCoincidentShraVisM(storm, 9999);
        const stormLow = lowCeilingCloud(storm?.state)?.baseFt;
        let clouds = (storm?.state?.clouds || [])
            .filter((cloud) => cloud.convective !== 'CB')
            .map((cloud) => ({ ...cloud }));
        if (Number.isFinite(stormLow)) {
            // Keep TEMPO ceiling at/above the PROB low cloud (hierarchy refines later).
            const bands = THRESHOLDS.tempoCloudBasesFt || [];
            const raised = bands.find((band) => band > stormLow) || stormLow;
            const baseFt = snapTempoBandAtOrBelow(raised) || raised;
            clouds = [{ amount: 'BKN', baseFt }];
        }
        return {
            ...storm.state,
            weather: ['SHRA'],
            visM,
            clouds,
            cavok: false,
        };
    }

    function cloneHourState(state) {
        if (!state) {
            return state;
        }
        return {
            ...state,
            weather: [...(state.weather || [])],
            clouds: (state.clouds || []).map((cloud) => ({ ...cloud })),
        };
    }

    /**
     * Post-storm background precip: demote SHRA→RA, ease vis, lift ceiling one
     * tempo band — storms have left, residual rain/showers are milder.
     */
    function demoteToBackgroundPrecipState(state) {
        const next = cloneHourState(state);
        const weather = dedupeWeatherCodes(
            (next.weather || []).map((code) => (code === 'SHRA' ? 'RA' : code)),
        );
        if (!weather.some((code) => PRECIP_WX.has(code))) {
            weather.push('RA');
        }
        let visM = Number.isFinite(next.visM) ? next.visM : 9999;
        const stormCap = THRESHOLDS.visStormShraM || 4000;
        // If vis still looks storm-tight, ease to the light precip ladder band.
        if (visM < stormCap) {
            visM = visibilityFromPrecipAmount(THRESHOLDS.precipRainMm || 0.2);
        }
        const bands = THRESHOLDS.tempoCloudBasesFt || [];
        const clouds = (next.clouds || []).map((cloud) => {
            if (cloud.convective === 'CB' || (cloud.amount !== 'BKN' && cloud.amount !== 'OVC')) {
                return cloud;
            }
            const raised = bands.find((band) => band > cloud.baseFt) || cloud.baseFt;
            return {
                ...cloud,
                amount: cloud.amount === 'OVC' ? 'BKN' : cloud.amount,
                baseFt: snapTempoBandAtOrBelow(raised) || raised,
            };
        });
        return {
            ...next,
            weather,
            visM,
            clouds,
            cavok: false,
        };
    }

    function tempoDurationHours(startMs, endExclusiveMs) {
        return Math.round((endExclusiveMs - startMs) / (60 * 60 * 1000));
    }

    function makeTempoPiece(template, startMs, endExclusiveMs, state, base) {
        const minHours = THRESHOLDS.tempoMinHours || 2;
        if (tempoDurationHours(startMs, endExclusiveMs) < minHours) {
            return null;
        }
        const piece = {
            kind: 'TEMPO',
            bareProb: false,
            windGroup: null,
            startMs,
            endExclusiveMs,
            sortKey: startMs,
            state: cloneHourState(state),
        };
        piece.text = renderGroupText(piece, base);
        return piece;
    }

    /**
     * Apply storm-coincident SHRA to a TEMPO state (upgrade RA/DZ → SHRA) and
     * tighten vis from storm peak precip / low-based floor.
     */
    function withStormCoincidentShra(state, storm) {
        const wx = state?.weather || [];
        const prevVis = Number.isFinite(state?.visM) ? state.visM : 9999;
        return {
            ...cloneHourState(state),
            weather: dedupeWeatherCodes([
                ...(wx.filter((code) => code !== 'DZ' && code !== 'RA' && code !== 'SHRA')),
                'SHRA',
            ]),
            visM: stormCoincidentShraVisM(storm, prevVis),
            cavok: false,
        };
    }

    /**
     * When TSRA is PROB'd (and not high-based), keep a SHRA TEMPO for that storm
     * window only. Split any overlapping longer TEMPO so pre/post-storm background
     * precip stays separate (typically milder RA, higher ceiling).
     */
    function alignTempoWithStormProb(tempoGroups, probGroups, base) {
        const stormProbs = (probGroups || []).filter((group) => hourHasTs(group.state));
        if (!stormProbs.length || !Array.isArray(tempoGroups)) {
            return;
        }
        const maxGapMs = (THRESHOLDS.stormShraAlignGapHours || 1) * 60 * 60 * 1000;
        stormProbs.forEach((storm) => {
            if (stormIsHighBased(storm)) {
                return;
            }
            const stormStart = storm.startMs;
            const stormEnd = storm.endExclusiveMs;
            // Second align pass: already have SHRA covering the storm window.
            const alreadyCovered = tempoGroups.some((tempo) => (
                tempo.startMs <= stormStart
                && tempo.endExclusiveMs >= stormEnd
                && (tempo.state?.weather || []).includes('SHRA')
            ));
            if (alreadyCovered) {
                return;
            }
            const candidates = tempoGroups.filter((tempo) => {
                if (tempo.startMs < stormEnd && tempo.endExclusiveMs > stormStart) {
                    return true;
                }
                if (
                    tempo.endExclusiveMs <= stormStart
                    && (stormStart - tempo.endExclusiveMs) <= maxGapMs
                ) {
                    return true;
                }
                if (
                    tempo.startMs >= stormEnd
                    && (tempo.startMs - stormEnd) <= maxGapMs
                ) {
                    return true;
                }
                return false;
            });
            candidates.sort((a, b) => (
                tempoStormAlignScore(b) - tempoStormAlignScore(a)
                || a.startMs - b.startMs
            ));
            const target = candidates[0] || null;
            const backgroundState = target
                ? cloneHourState(target.state)
                : null;
            const shraState = target
                ? withStormCoincidentShra(backgroundState, storm)
                : buildStormCoincidentShraState(storm);
            const postState = backgroundState
                ? demoteToBackgroundPrecipState(backgroundState)
                : null;

            const pieces = [];
            if (target && target.startMs < stormStart) {
                const pre = makeTempoPiece(
                    target,
                    target.startMs,
                    Math.min(target.endExclusiveMs, stormStart),
                    backgroundState,
                    base,
                );
                if (pre) {
                    pieces.push(pre);
                }
            }
            const mid = makeTempoPiece(
                target || { kind: 'TEMPO' },
                stormStart,
                stormEnd,
                shraState,
                base,
            );
            if (mid) {
                pieces.push(mid);
            }
            if (target && target.endExclusiveMs > stormEnd && postState) {
                const post = makeTempoPiece(
                    target,
                    Math.max(target.startMs, stormEnd),
                    target.endExclusiveMs,
                    postState,
                    base,
                );
                if (post) {
                    pieces.push(post);
                }
            }

            if (!pieces.length) {
                return;
            }
            if (target) {
                const index = tempoGroups.indexOf(target);
                if (index >= 0) {
                    tempoGroups.splice(index, 1, ...pieces);
                } else {
                    tempoGroups.push(...pieces);
                }
            } else {
                tempoGroups.push(...pieces);
            }
        });
    }

    function lclHeightFt(tempC, dewpointC) {
        if (!Number.isFinite(tempC) || !Number.isFinite(dewpointC)) {
            return null;
        }
        // Rough aviation rule of thumb: LCL AGL ≈ 125 m * (T-Td)[°C] → feet.
        const spread = Math.max(0, tempC - dewpointC);
        return Math.max(0, spread * 125 * 3.28084);
    }

    function modelKeyFromSoundingModel(modelId) {
        const raw = String(modelId || '');
        if (raw.includes('icon')) {
            return 'icon';
        }
        return 'gfs';
    }

    function mergeHourRaw(frame, om, policySample) {
        const policy = policySample || {};
        const tempC = om?.tempC;
        const dewpointC = om?.dewpointC;
        return {
            validTime: frame.validTime,
            hour: frame.hour,
            windKt: om?.windKt ?? null,
            windDir: om?.windDir ?? null,
            gustKt: om?.gustKt ?? null,
            tempC,
            dewpointC,
            surfaceRh: om?.rh ?? null,
            lclFt: lclHeightFt(tempC, dewpointC),
            profileCloudBaseFt: om?.profileCloudBaseFt ?? null,
            elevatedCloudBaseFt: om?.elevatedCloudBaseFt ?? null,
            omPrecipMm: om?.precipMm ?? null,
            omShowersMm: om?.showersMm ?? null,
            omWeatherCode: om?.weatherCode ?? null,
            omLowCloudCover: om?.lowCloudCover ?? null,
            omCloudBaseFt: om?.cloudBaseFt ?? null,
            capeJkg: om?.capeJkg ?? null,
            precipMm: policy.precip ?? om?.precipMm ?? null,
            // Prefer model convective showers; Policy ts_precip is a TS-specific assist.
            showersMm: om?.showersMm ?? null,
            tsMm: policy.ts_precip ?? null,
            snowMm: policy.snow ?? null,
            fogCat: policy.fog ?? null,
            freezingFogCat: policy.freezing_fog ?? null,
            drizzleRh: policy.drizzle ?? null,
            lowCloudRh: policy.low_cloud ?? om?.lowCloudCover ?? null,
            shearCat: Number.isFinite(policy.shear) ? policy.shear : null,
            leeCat: Number.isFinite(policy.lee) ? policy.lee : null,
            policyAvailable: Boolean(policySample),
        };
    }

    /**
     * AGL base of the first solid moist deck on the OM pressure ladder.
     * Used overnight when surface LCL is biased low by a nocturnal inversion.
     * minAglFt skips fog/shallow surface decks (elevated SCT under BR/FG).
     */
    function cloudBaseAglFtFromHourlyProfile(hourly, hourIndex, elevationM, { minAglFt = 0 } = {}) {
        if (!hourly?.time || hourIndex < 0) {
            return null;
        }
        const levels = THRESHOLDS.cloudBaseLevelsHpa || [1000, 975, 950, 925, 900, 850];
        const minRh = THRESHOLDS.cloudBaseMinRh || 95;
        const maxSpread = THRESHOLDS.cloudBaseMaxSpreadC || 0.5;
        const elev = Number.isFinite(elevationM) ? elevationM : 0;
        const floorFt = Number.isFinite(minAglFt) ? minAglFt : 0;

        const sfcT = hourly.temperature_2m?.[hourIndex];
        const sfcTd = hourly.dew_point_2m?.[hourIndex];
        const sfcRh = hourly.relative_humidity_2m?.[hourIndex];
        if (Number.isFinite(sfcT) && Number.isFinite(sfcTd)) {
            const sfcSpread = sfcT - sfcTd;
            if (sfcSpread <= maxSpread || (Number.isFinite(sfcRh) && sfcRh >= minRh)) {
                const sfcBase = Math.max(0, lclHeightFt(sfcT, sfcTd) || 100);
                // Surface-based cloud / fog — keep a very low base unless skipped.
                if (sfcBase >= floorFt) {
                    return sfcBase;
                }
            }
        }

        for (const level of levels) {
            const tempC = hourly[`temperature_${level}hPa`]?.[hourIndex];
            let dewpointC = hourly[`dew_point_${level}hPa`]?.[hourIndex];
            const rh = hourly[`relative_humidity_${level}hPa`]?.[hourIndex];
            const heightM = hourly[`geopotential_height_${level}hPa`]?.[hourIndex];
            if (!Number.isFinite(tempC) || !Number.isFinite(heightM)) {
                continue;
            }
            const aglFt = Math.max(0, (heightM - elev) * 3.28084);
            if (aglFt < floorFt) {
                continue;
            }
            if (!Number.isFinite(dewpointC) && Number.isFinite(rh) && rh > 0) {
                // Magnus-Tetens when dewpoint is omitted.
                const clamped = Math.min(100, rh);
                const gamma = Math.log(clamped / 100) + (17.67 * tempC) / (tempC + 243.5);
                dewpointC = (243.5 * gamma) / (17.67 - gamma);
            }
            if (!Number.isFinite(dewpointC)) {
                continue;
            }
            const spread = tempC - dewpointC;
            const moist = spread <= maxSpread || (Number.isFinite(rh) && rh >= minRh);
            if (!moist) {
                continue;
            }
            return aglFt;
        }
        return null;
    }

    function extractOpenMeteoHour(hourly, hourIndex, { elevationM = null } = {}) {
        if (!hourly?.time || hourIndex < 0) {
            return null;
        }
        const windKt = hourly.wind_speed_10m?.[hourIndex];
        const windDir = hourly.wind_direction_10m?.[hourIndex];
        const gustKt = hourly.wind_gusts_10m?.[hourIndex];
        const tempC = hourly.temperature_2m?.[hourIndex];
        const dewpointC = hourly.dew_point_2m?.[hourIndex];
        const rh = hourly.relative_humidity_2m?.[hourIndex];
        const precipMm = hourly.precipitation?.[hourIndex];
        // GFS convective precip; may be absent on some ICON/seamless paths.
        const showersMm = hourly.showers?.[hourIndex];
        const capeJkg = hourly.cape?.[hourIndex];
        const weatherCode = hourly.weather_code?.[hourIndex];
        const lowCloudCover = hourly.cloud_cover_low?.[hourIndex] ?? hourly.cloud_cover?.[hourIndex];
        // Open-Meteo cloud base is metres AMSL when present — convert to AGL.
        const cloudBaseM = hourly.cloud_base?.[hourIndex];
        let cloudBaseFt = Number.isFinite(cloudBaseM) ? cloudBaseM * 3.28084 : null;
        if (Number.isFinite(cloudBaseFt) && Number.isFinite(elevationM)) {
            cloudBaseFt = Math.max(0, cloudBaseFt - (elevationM * 3.28084));
        }
        const profileCloudBaseFt = cloudBaseAglFtFromHourlyProfile(hourly, hourIndex, elevationM);
        // Deck above fog/shallow stratus (inversion residual cloud for mean SCT).
        const elevatedCloudBaseFt = cloudBaseAglFtFromHourlyProfile(
            hourly,
            hourIndex,
            elevationM,
            { minAglFt: 1500 },
        );
        const pressureMsl = hourly.pressure_msl?.[hourIndex];
        return {
            windKt: Number.isFinite(windKt) ? windKt : null,
            windDir: Number.isFinite(windDir) ? windDir : null,
            gustKt: Number.isFinite(gustKt) ? gustKt : null,
            tempC: Number.isFinite(tempC) ? tempC : null,
            dewpointC: Number.isFinite(dewpointC) ? dewpointC : null,
            rh: Number.isFinite(rh) ? rh : null,
            precipMm: Number.isFinite(precipMm) ? precipMm : null,
            showersMm: Number.isFinite(showersMm) ? showersMm : null,
            capeJkg: Number.isFinite(capeJkg) ? capeJkg : null,
            weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
            lowCloudCover: Number.isFinite(lowCloudCover) ? lowCloudCover : null,
            cloudBaseFt,
            profileCloudBaseFt,
            elevatedCloudBaseFt,
            qnhHpa: Number.isFinite(pressureMsl) ? pressureMsl : null,
        };
    }

    /** BoM-style TAF temp: 08, 12, M02 (negative → M). */
    function formatRmkTemp(tempC) {
        if (!Number.isFinite(tempC)) {
            return '//';
        }
        const rounded = Math.round(tempC);
        if (rounded < 0) {
            return `M${String(Math.abs(rounded)).padStart(2, '0')}`;
        }
        return String(rounded).padStart(2, '0');
    }

    /** BoM-style QNH: four-digit hPa (e.g. 1022). */
    function formatRmkQnh(qnhHpa) {
        if (!Number.isFinite(qnhHpa)) {
            return '////';
        }
        return String(Math.round(qnhHpa)).padStart(4, '0');
    }

    function formatDdhhmm(dateValue) {
        if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
            return '------';
        }
        return `${formatDdhh(dateValue)}00`;
    }

    /** Policy shear/lee categories: 1=MOD, 2=MOD/SEV, 3=SEV. */
    function turbCategoryFromHour(hour) {
        const shear = Number(hour?.shearCat);
        const lee = Number(hour?.leeCat);
        const vals = [shear, lee].filter((value) => Number.isFinite(value) && value >= 1);
        if (!vals.length) {
            return 0;
        }
        return Math.min(3, Math.max(...vals.map((value) => Math.round(value))));
    }

    /**
     * TAF RMK intensity bucket: MOD/SEV (2) forecasts as MOD, so it shares a
     * run with MOD (1). Only SEV (3) stays separate.
     */
    function turbForecastCategory(hour) {
        const raw = turbCategoryFromHour(hour);
        if (raw >= 3) return 3;
        if (raw >= 1) return 1;
        return 0;
    }

    function turbLabel(category) {
        if (category >= 3) return 'SEV';
        if (category >= 1) return 'MOD';
        return null;
    }

    function buildTurbRuns(hours) {
        const cats = hours.map(turbForecastCategory);
        const runs = [];
        let start = null;
        let cat = 0;
        const flush = (end) => {
            if (start == null || end < start) {
                start = null;
                cat = 0;
                return;
            }
            runs.push({
                start,
                end,
                category: cat,
                startMs: hours[start].validTime.getTime(),
                endExclusiveMs: hours[end].validTime.getTime() + 60 * 60 * 1000,
            });
            start = null;
            cat = 0;
        };
        cats.forEach((value, index) => {
            if (value < 1) {
                flush(index - 1);
                return;
            }
            if (start == null) {
                start = index;
                cat = value;
                return;
            }
            if (value !== cat) {
                flush(index - 1);
                start = index;
                cat = value;
            }
        });
        flush(cats.length - 1);
        return runs;
    }

    function bridgeTurbRuns(runs) {
        if (runs.length < 2) {
            return runs.slice();
        }
        const out = [];
        runs.forEach((run) => {
            const prev = out[out.length - 1];
            const gapHours = prev
                ? Math.round((run.startMs - prev.endExclusiveMs) / (60 * 60 * 1000))
                : Number.POSITIVE_INFINITY;
            // Bridge short gaps; keep max intensity across the merged spell.
            if (prev && gapHours >= 0 && gapHours <= THRESHOLDS.turbBridgeMaxGapHours) {
                prev.endExclusiveMs = run.endExclusiveMs;
                prev.end = run.end;
                prev.category = Math.max(prev.category, run.category);
                return;
            }
            out.push({ ...run });
        });
        return out;
    }

    /**
     * Independent turbulence-line pressure: strongly prefer ≤3 TURB RMK lines.
     * Merges nearest neighbours (max category) when over budget.
     */
    function simplifyTurbRuns(runs, validityEndMs) {
        const minHours = Math.max(1, THRESHOLDS.turbMinHours || 3);
        const modMinHours = Math.max(minHours, THRESHOLDS.turbModMinHours || 4);
        let current = bridgeTurbRuns(runs).map((run) => {
            const endExclusiveMs = validityEndMs != null
                ? Math.min(run.endExclusiveMs, validityEndMs)
                : run.endExclusiveMs;
            return { ...run, endExclusiveMs };
        }).filter((run) => {
            if (run.endExclusiveMs <= run.startMs) {
                return false;
            }
            const durHours = (run.endExclusiveMs - run.startMs) / (60 * 60 * 1000);
            // Drop transient/marginal spells — 1 h MOD and short MOD runs.
            const need = run.category >= 3 ? minHours : modMinHours;
            return durHours >= need;
        });

        while (current.length > THRESHOLDS.turbMaxLines) {
            let bestIndex = 0;
            let bestScore = Infinity;
            for (let index = 0; index < current.length - 1; index += 1) {
                const left = current[index];
                const right = current[index + 1];
                const gapHours = Math.max(0, (right.startMs - left.endExclusiveMs) / (60 * 60 * 1000));
                const catJump = Math.abs(left.category - right.category);
                // Prefer merging close gaps and similar intensities first.
                const score = gapHours * 10 + catJump * 3
                    + ((right.endExclusiveMs - left.startMs) / (60 * 60 * 1000)) * 0.05;
                if (score < bestScore) {
                    bestScore = score;
                    bestIndex = index;
                }
            }
            const left = current[bestIndex];
            const right = current[bestIndex + 1];
            const merged = {
                start: left.start,
                end: right.end,
                category: Math.max(left.category, right.category),
                startMs: left.startMs,
                endExclusiveMs: right.endExclusiveMs,
            };
            current = [
                ...current.slice(0, bestIndex),
                merged,
                ...current.slice(bestIndex + 2),
            ];
        }
        return current;
    }

    function formatTurbRmkLine(run) {
        const label = turbLabel(run.category);
        if (!label) {
            return null;
        }
        const base = THRESHOLDS.turbBaseFt;
        return `FM${formatDdhhmm(new Date(run.startMs))} ${label} TURB BLW ${base}FT TL${formatDdhhmm(new Date(run.endExclusiveMs))}`;
    }

    function buildTurbRmkLines(hours, validityEnd) {
        if (!hours?.length) {
            return [];
        }
        const validityEndMs = validityEnd instanceof Date ? validityEnd.getTime() : null;
        const runs = simplifyTurbRuns(buildTurbRuns(hours), validityEndMs);
        return runs.map(formatTurbRmkLine).filter(Boolean);
    }

    function buildTqRmkLine(hourly, startValid) {
        if (!hourly?.time?.length || !(startValid instanceof Date)) {
            return null;
        }
        const offsets = [0, 3, 6, 9];
        const temps = [];
        const qnhs = [];
        let any = false;
        offsets.forEach((offsetHours) => {
            const target = new Date(startValid.getTime() + offsetHours * 60 * 60 * 1000);
            const index = nearestHourlyIndex(hourly.time, target);
            const sample = index >= 0 ? extractOpenMeteoHour(hourly, index) : null;
            if (sample && (Number.isFinite(sample.tempC) || Number.isFinite(sample.qnhHpa))) {
                any = true;
            }
            temps.push(formatRmkTemp(sample?.tempC));
            qnhs.push(formatRmkQnh(sample?.qnhHpa));
        });
        if (!any) {
            return null;
        }
        return `T ${temps.join(' ')} Q ${qnhs.join(' ')}`;
    }

    /**
     * Full RMK block: turbulence FM/TL lines (from Policy shear/lee), then T/Q.
     * RMK content is excluded from main TAF line-count resistance.
     */
    function buildRmkBlock(hourly, startValid, hours, validityEnd) {
        const turbLines = buildTurbRmkLines(hours, validityEnd);
        const tqLine = buildTqRmkLine(hourly, startValid);
        if (!turbLines.length && !tqLine) {
            return null;
        }
        const lines = ['RMK', ...turbLines];
        if (tqLine) {
            lines.push(tqLine);
        }
        return lines;
    }

    function nearestHourlyIndex(times, targetDate) {
        const targetKey = targetDate.toISOString().slice(0, 13);
        const exact = times.findIndex((timeText) => String(timeText).slice(0, 13) === targetKey);
        if (exact >= 0) {
            return exact;
        }
        const targetMs = targetDate.getTime();
        let bestIndex = -1;
        let bestDelta = Infinity;
        times.forEach((timeText, index) => {
            const ms = Date.parse(timeText);
            if (!Number.isFinite(ms)) {
                return;
            }
            const delta = Math.abs(ms - targetMs);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = index;
            }
        });
        return bestIndex;
    }

    async function fetchOpenMeteoRange(lat, lon, startDate, endDate, modelId) {
        const models = String(modelId || 'gfs_seamless');
        const start = startDate.toISOString().slice(0, 10);
        const end = endDate.toISOString().slice(0, 10);
        const levelVars = [];
        (THRESHOLDS.cloudBaseLevelsHpa || []).forEach((level) => {
            levelVars.push(
                `temperature_${level}hPa`,
                `dew_point_${level}hPa`,
                `relative_humidity_${level}hPa`,
                `geopotential_height_${level}hPa`,
            );
        });
        const hourlyVars = [
            'temperature_2m',
            'dew_point_2m',
            'relative_humidity_2m',
            'wind_speed_10m',
            'wind_direction_10m',
            'wind_gusts_10m',
            'precipitation',
            'showers',
            'cape',
            'weather_code',
            'cloud_cover',
            'cloud_cover_low',
            'cloud_base',
            'pressure_msl',
            ...levelVars,
        ].join(',');
        const body = new URLSearchParams({
            latitude: lat.toFixed(4),
            longitude: lon.toFixed(4),
            hourly: hourlyVars,
            models,
            wind_speed_unit: 'kn',
            timezone: 'UTC',
            start_date: start,
            end_date: end,
        });
        const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const isTransient = (status) => status === 429 || status === 502 || status === 503 || status === 504;
        const maxAttempts = 3;
        let response = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            response = await fetch('https://api.open-meteo.com/v1/forecast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body,
            });
            if (response.ok || !isTransient(response.status) || attempt === maxAttempts) {
                break;
            }
            await sleepMs(400 * attempt * attempt);
        }
        if (!response?.ok) {
            throw new Error(`Open-Meteo TAF request failed (${response?.status || 'network'})`);
        }
        const payload = await response.json();
        if (!payload.hourly?.time?.length) {
            throw new Error('No hourly Open-Meteo data for TAF draft');
        }
        return {
            hourly: payload.hourly,
            elevationM: Number.isFinite(payload.elevation) ? payload.elevation : null,
        };
    }

    function resolveStationId(icao, lat, lon, aerodromes) {
        if (icao) {
            return icao;
        }
        if (!Array.isArray(aerodromes) || !aerodromes.length) {
            return 'MAP';
        }
        let best = null;
        let bestDist = Infinity;
        aerodromes.forEach((site) => {
            const dist = Math.hypot((site.lat - lat), (site.lon - lon));
            if (dist < bestDist) {
                bestDist = dist;
                best = site;
            }
        });
        if (best && bestDist <= THRESHOLDS.nearestIcaoDeg) {
            return best.icao;
        }
        return 'MAP';
    }

    async function buildDraft({
        lat,
        lon,
        icao = null,
        modelId = 'gfs_seamless',
        aerodromes = [],
    } = {}) {
        const controller = window.AnimationController;
        if (!controller?.getSelectedRange) {
            throw new Error('Selected time range is unavailable');
        }
        const range = controller.getSelectedRange();
        if (!range?.frames?.length) {
            throw new Error('Select a time range to draft a TAF');
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            throw new Error('Choose a location or click the map');
        }

        const startValid = range.frames[0].validTime;
        const endValid = range.frames[range.frames.length - 1].validTime;
        const policyModel = modelKeyFromSoundingModel(modelId);
        const foresightHours = Math.max(0, THRESHOLDS.tafForesightHours || 0);
        const lastFrame = range.frames[range.frames.length - 1];
        const foresightFrames = [];
        for (let step = 1; step <= foresightHours; step += 1) {
            foresightFrames.push({
                frameIndex: (lastFrame.frameIndex || 0) + step,
                hour: Number(lastFrame.hour) + step,
                validTime: new Date(lastFrame.validTime.getTime() + (step * 60 * 60 * 1000)),
                foresight: true,
            });
        }
        const allFrames = range.frames.concat(foresightFrames);
        const forecastHours = allFrames.map((frame) => frame.hour);
        const foresightEnd = allFrames[allFrames.length - 1].validTime;

        let hourly = null;
        let elevationM = null;
        let openMeteoError = null;
        const policyPromise = controller.samplePolicyAt?.(lat, lon, policyModel, forecastHours) || Promise.resolve(null);
        try {
            const omBundle = await fetchOpenMeteoRange(lat, lon, startValid, foresightEnd, modelId);
            hourly = omBundle?.hourly || null;
            elevationM = omBundle?.elevationM ?? null;
        } catch (error) {
            openMeteoError = error;
            console.warn('Open-Meteo TAF fetch failed; continuing with Policy samples if available:', error);
        }
        const policySample = await policyPromise;

        const hours = allFrames.map((frame) => {
            const omIndex = hourly?.time ? nearestHourlyIndex(hourly.time, frame.validTime) : -1;
            const om = omIndex >= 0
                ? extractOpenMeteoHour(hourly, omIndex, { elevationM })
                : null;
            const policyHour = policySample?.byHour?.[frame.hour] || null;
            const raw = mergeHourRaw(frame, om, policyHour);
            raw.siteLat = lat;
            raw.siteLon = lon;
            raw.diurnalPhase = diurnalPhaseAt(lat, lon, frame.validTime);
            if (!Number.isFinite(raw.windKt)) {
                raw.windKt = 0;
                raw.windDir = 0;
            }
            const enriched = enrichHourState(raw);
            enriched.foresight = Boolean(frame.foresight);
            return enriched;
        });

        if (!hours.length) {
            throw new Error('Unable to build hourly TAF state for this range');
        }
        if (!hourly && !policySample) {
            throw new Error(openMeteoError?.message || 'Open-Meteo and Policy weather sources unavailable');
        }

        const publishedHours = hours.filter((hour) => !hour.foresight);
        const station = resolveStationId(icao, lat, lon, aerodromes);
        const rawBase = dominantState(publishedHours) || publishedHours[0] || hours[0];
        const header = `TAF ${station} ${formatDdhh(startValid)}/${formatDdhh(endValid)}`;
        const changeGroups = buildChangeGroups(hours, endValid, {
            validityHourCount: publishedHours.length,
            lat,
            lon,
        });
        // Lift mean cloud only when a TEMPO/PROB holding covers lower ceilings.
        let base = applyMeanCloudLiftIfHeld(rawBase, changeGroups);
        // Opening SHRA/RA TEMPO at TAF start → header -SHRA SCT+BKN (no onset FM).
        // May lower the opening TEMPO after the main pipeline — re-stack TSRA PROB
        // so it stays strictly below (BKN004 TEMPO → BKN003 PROB, not same band).
        const tafStartMs = publishedHours[0]?.validTime?.getTime?.();
        base = seedHeaderFromOpeningPrecip(base, changeGroups, tafStartMs);
        enforceCloudCeilingHierarchy(base, changeGroups);
        changeGroups.forEach((group) => {
            group.text = renderGroupText(group, base);
        });
        // Base line: 9999 vis, BKN (never OVC); TSRA/FG are PROB-only.
        const lines = [
            header,
            formatConditionBody(base, { allowTsra: false, allowRaDz: false, meanStyle: true }),
            ...changeGroups.map((group) => group.text),
        ];
        // RMK (TURB / T / Q) is outside main TAF line-count resistance.
        const rmkLines = buildRmkBlock(hourly, startValid, publishedHours, endValid);
        if (rmkLines?.length) {
            lines.push(...rmkLines);
        }
        return {
            text: lines.join('\n'),
            notes: '',
            station,
            policyAvailable: Boolean(policySample),
            hours,
            thresholds: THRESHOLDS,
        };
    }

    window.TafPreview = {
        buildDraft,
        THRESHOLDS,
        formatWindGroup,
        formatConditionBody,
        formatThunderstormProbWind,
        // Test/debug helpers for holding simplification / mean lines
        _simplifyHoldingsForLineBudget: simplifyHoldingsForLineBudget,
        _tafLineResistance: tafLineResistance,
        _buildMeanChangeGroups: buildMeanChangeGroups,
        _classifyMeanChange: classifyMeanChange,
    };
})();
