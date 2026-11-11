import { DashboardTileTypes, type DashboardTile } from '@lightdash/common';
import { type Layout } from 'react-grid-layout';
import {
    dashboardEditActions as actions,
    initialDashboardEditState,
    dashboardEditReducer as reducer,
    type DashboardEditState,
} from '../dashboard/store/dashboardEditReducer';
import {
    AUTO_FIT_MAX_SCALE,
    AUTO_FIT_MIN_SCALE,
    canFitGridToScreen,
    closeTileGaps,
    tidyTiles,
    convertLayoutToBaseCoordinates,
    DEFAULT_ROW_HEIGHT,
    FINE_GRID_SCALE,
    FIT_TO_SCREEN_MIN_ROW_HEIGHT,
    getAutoFitRowHeight,
    getBreakpointForWidth,
    getFitToScreenRowHeight,
    getGridHeight,
    getLayoutToSaveAfterEdit,
    getGridTotalRows,
    getViewModeActiveTabTiles,
    hasGridItemMoved,
    getDashboardLayouts,
    getMobileGridLayout,
    getResponsiveGridLayoutProps,
    getRowHeightForScale,
    GRID_MARGIN,
    keepResizedTileCorner,
    matchesSavedLayout,
    settleLayoutAfterEdit,
} from './gridUtils';

const chart = (uuid: string, x: number, y: number, h = 6): DashboardTile => ({
    uuid,
    x,
    y,
    h,
    w: 12,
    tabUuid: null,
    type: DashboardTileTypes.SAVED_CHART,
    properties: { savedChartUuid: null },
});

describe('mobile dashboard layout', () => {
    it('reads rows left to right, stacks without overlaps, and leaves saved positions intact', () => {
        const tiles = [
            chart('last', 0, 10),
            chart('right', 12, 0),
            chart('left', 0, 0),
        ];
        const saved = structuredClone(tiles);
        const layout = getMobileGridLayout(tiles);
        expect(layout.map(({ i }) => i)).toEqual(['left', 'right', 'last']);
        expect(layout.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([
            { x: 0, y: 0, w: 1, h: 5 },
            { x: 0, y: 5, w: 1, h: 5 },
            { x: 0, y: 10, w: 1, h: 5 },
        ]);
        expect(tiles).toEqual(saved);
        expect(
            layout.every(
                (item) =>
                    !item.isDraggable && !item.isResizable && item.minW === 1,
            ),
        ).toBe(true);
    });

    it('keeps headings compact and gives small charts readable height', () => {
        const heading: DashboardTile = {
            ...chart('heading', 0, 0, 1),
            type: DashboardTileTypes.HEADING,
            properties: { text: 'Revenue' },
        };
        expect(
            getMobileGridLayout([heading, chart('chart', 0, 1, 2)]).map(
                ({ h, y }) => ({ h, y }),
            ),
        ).toEqual([
            { h: 1, y: 0 },
            { h: 5, y: 1 },
        ]);
    });

    it('bounds chart heights on phones without changing saved sizes', () => {
        const tiles = [chart('small', 0, 0, 1), chart('large', 0, 2, 20)];
        expect(getMobileGridLayout(tiles).map(({ h }) => h)).toEqual([5, 8]);
        expect(getDashboardLayouts(tiles).lg.map(({ h }) => h)).toEqual([
            1, 20,
        ]);
    });

    it('uses a deterministic order for overlapping saved tiles', () => {
        const tiles = [chart('b', 0, 0), chart('a', 0, 0)];
        expect(getMobileGridLayout(tiles)).toEqual(
            getMobileGridLayout([...tiles].reverse()),
        );
    });

    it('preserves desktop coordinates and editing behavior at every breakpoint', () => {
        const tiles = [chart('chart', 12, 5, 9)];
        const viewer = getDashboardLayouts(tiles);
        expect(viewer.lg[0]).toMatchObject({ x: 12, y: 5, w: 12, h: 9 });
        expect(viewer.xs[0]).toMatchObject({
            x: 0,
            y: 0,
            w: 1,
            isDraggable: false,
        });
        const editor = getDashboardLayouts(tiles, true);
        expect(editor.xs[0]).toMatchObject({
            x: 12,
            y: 5,
            w: 12,
            h: 9,
            isDraggable: true,
            isResizable: true,
        });
    });
});

describe('breakpoint for a measured width', () => {
    const breakpoints = { lg: 1200, md: 996, sm: 768, xs: 0 };

    it('matches react-grid-layout: largest breakpoint strictly narrower than the width', () => {
        expect(getBreakpointForWidth(breakpoints, 1400)).toBe('lg');
        expect(getBreakpointForWidth(breakpoints, 1200)).toBe('md');
        expect(getBreakpointForWidth(breakpoints, 1119)).toBe('md');
        expect(getBreakpointForWidth(breakpoints, 800)).toBe('sm');
        expect(getBreakpointForWidth(breakpoints, 300)).toBe('xs');
    });

    it('falls back to the smallest breakpoint when nothing is narrower', () => {
        expect(getBreakpointForWidth({ wide: 600, narrow: 300 }, 100)).toBe(
            'narrow',
        );
    });
});

describe('fit to screen', () => {
    it('counts rows down to the lowest tile bottom', () => {
        expect(getGridTotalRows([])).toBe(0);
        expect(
            getGridTotalRows([chart('a', 0, 0, 6), chart('b', 12, 3, 9)]),
        ).toBe(12);
    });

    it('fills the available height, keeping row proportions', () => {
        const rows = 12;
        const rowHeight = getFitToScreenRowHeight(1000, rows);
        const height = getGridHeight(rows, rowHeight);
        expect(height).toBeLessThanOrEqual(1000);
        expect(height).toBeGreaterThan(998);
        // a 6-row tile takes half the grid
        expect(getGridHeight(6, rowHeight)).toBeCloseTo((height - 10) / 2, 0);
    });

    it('clamps to the minimum row height', () => {
        expect(getFitToScreenRowHeight(100, 50)).toBe(
            FIT_TO_SCREEN_MIN_ROW_HEIGHT,
        );
    });

    it('falls back to the default row height without rows', () => {
        expect(getFitToScreenRowHeight(1000, 0)).toBe(DEFAULT_ROW_HEIGHT);
    });

    it('is only offered when the natural height is at most 2x the viewport', () => {
        const natural = getGridHeight(20, DEFAULT_ROW_HEIGHT);
        expect(canFitGridToScreen(natural / 2, 20)).toBe(true);
        expect(canFitGridToScreen(natural / 2 - 1, 20)).toBe(false);
        expect(canFitGridToScreen(1000, 0)).toBe(false);
        expect(canFitGridToScreen(0, 5)).toBe(false);
    });

    it('takes the active tab tiles, with stale tabs on the first tab', () => {
        const tab = (uuid: string, hidden = false) => ({
            uuid,
            name: uuid,
            order: 0,
            hidden,
        });
        const tiles = [
            { ...chart('a', 0, 0), tabUuid: 't1' },
            { ...chart('b', 0, 0), tabUuid: 't2' },
            { ...chart('c', 0, 0), tabUuid: 'gone' },
        ];
        const uuids = (result: DashboardTile[]) => result.map((t) => t.uuid);

        expect(
            uuids(
                getViewModeActiveTabTiles(tiles, [tab('t1'), tab('t2')], 't1'),
            ),
        ).toEqual(['a', 'c']);
        expect(
            uuids(
                getViewModeActiveTabTiles(tiles, [tab('t1'), tab('t2')], 't2'),
            ),
        ).toEqual(['b']);
        // one visible tab: single grid without the hidden tab's tiles
        expect(
            uuids(
                getViewModeActiveTabTiles(
                    tiles,
                    [tab('t1'), tab('t2', true)],
                    't1',
                ),
            ),
        ).toEqual(['a', 'c']);
    });

    describe('auto fit', () => {
        const scaleOf = (rowHeight: number) => rowHeight / DEFAULT_ROW_HEIGHT;
        const viewportFor = (rows: number, scale: number) =>
            getGridHeight(rows, DEFAULT_ROW_HEIGHT * scale) + 1;

        it('fills the viewport when the squash is gentle', () => {
            const rowHeight = getAutoFitRowHeight(viewportFor(20, 0.8), 20);
            expect(scaleOf(rowHeight!)).toBeCloseTo(0.8, 2);
            expect(getGridHeight(20, rowHeight!)).toBeLessThanOrEqual(
                viewportFor(20, 0.8),
            );
        });

        it('keeps the natural height below the squash floor', () => {
            expect(
                getAutoFitRowHeight(
                    viewportFor(20, AUTO_FIT_MIN_SCALE * 0.98),
                    20,
                ),
            ).toBeNull();
            expect(
                scaleOf(
                    getAutoFitRowHeight(
                        viewportFor(20, AUTO_FIT_MIN_SCALE * 1.02),
                        20,
                    )!,
                ),
            ).toBeCloseTo(AUTO_FIT_MIN_SCALE * 1.02, 2);
            expect(getAutoFitRowHeight(1000, 0)).toBeNull();
            expect(getAutoFitRowHeight(0, 5)).toBeNull();
        });

        it('stretches a short grid, up to the cap', () => {
            expect(
                scaleOf(getAutoFitRowHeight(viewportFor(4, 1.5), 4)!),
            ).toBeCloseTo(1.5, 2);
            expect(getAutoFitRowHeight(viewportFor(4, 3), 4)).toBe(
                DEFAULT_ROW_HEIGHT * AUTO_FIT_MAX_SCALE,
            );
        });
    });

    it('steps the grid by one row plus the gap below it', () => {
        expect(getResponsiveGridLayoutProps().rowHeight).toBe(
            DEFAULT_ROW_HEIGHT + GRID_MARGIN[1],
        );
        expect(getResponsiveGridLayoutProps({ rowHeight: 80 }).rowHeight).toBe(
            80 + GRID_MARGIN[1],
        );
    });
});

describe('fine edit grid', () => {
    const fineProps = getResponsiveGridLayoutProps({
        isEditMode: true,
        gridScale: FINE_GRID_SCALE,
    });

    it('draws every saved dashboard at the same size and place', () => {
        const rowHeight = getRowHeightForScale(FINE_GRID_SCALE);
        const pixelHeight = (rows: number, height: number) =>
            rows * height + (rows - 1) * GRID_MARGIN[1];
        const [fine] = getDashboardLayouts(
            [chart('a', 14, 3, 6)],
            true,
            FINE_GRID_SCALE,
        ).lg;
        expect(pixelHeight(fine.h, rowHeight)).toBe(
            pixelHeight(6, DEFAULT_ROW_HEIGHT),
        );
        expect(fine.x / fineProps.cols.lg).toBe(14 / 36);
    });

    it('saves untouched tiles exactly as they were', () => {
        const tiles = [chart('a', 14, 3, 6), chart('b', 21, 0, 2)];
        const layout = getDashboardLayouts(tiles, true, FINE_GRID_SCALE).lg;
        const saved = convertLayoutToBaseCoordinates(layout, FINE_GRID_SCALE);
        expect(saved.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual(
            tiles.map(({ x, y, w, h }) => ({ x, y, w, h })),
        );
    });

    it('keeps a half-step move instead of rounding it away', () => {
        const [saved] = convertLayoutToBaseCoordinates(
            [{ i: 'a', x: 29, y: 7, w: 13, h: 9 }],
            FINE_GRID_SCALE,
        );
        expect(saved).toMatchObject({ x: 14.5, y: 3.5, w: 6.5, h: 4.5 });
    });
});

describe('a drag or resize that ends', () => {
    const item = { i: 'a', x: 4, y: 2, w: 12, h: 6 };

    it('moved nothing when the tile was only clicked', () => {
        expect(hasGridItemMoved(item, { ...item })).toBe(false);
    });

    it.each([{ x: 5 }, { y: 3 }, { w: 13 }, { h: 7 }])(
        'moved the tile when it ends at %o',
        (change) => {
            expect(hasGridItemMoved(item, { ...item, ...change })).toBe(true);
        },
    );
});

describe('same grid at every window width', () => {
    const props = getResponsiveGridLayoutProps({ isEditMode: true });
    const row = [
        chart('a', 0, 0, 4),
        chart('b', 14, 0, 4),
        chart('c', 21, 0, 4),
        chart('d', 28, 0, 4),
    ].map((tile, index) => ({ ...tile, w: [14, 7, 7, 8][index] }));

    it('keeps a row of 14, 7, 7 and 8 wide tiles inside the grid on medium windows', () => {
        const medium = getDashboardLayouts(row, false).md;
        const ends = medium.map(({ x, w }) => x + w);
        expect(ends).toEqual([14, 21, 28, 36]);
        expect(Math.max(...ends)).toBeLessThanOrEqual(props.cols.md);
    });

    it('saves the width of a tile that was only made taller on a narrow window', () => {
        const narrow = getDashboardLayouts(
            [{ ...chart('a', 0, 0, 4), w: 7 }],
            true,
        ).sm;
        const [saved] = convertLayoutToBaseCoordinates([
            { ...narrow[0], h: narrow[0].h + 1 },
        ]);
        expect(saved).toMatchObject({ w: 7, h: 5 });
    });

    it('lets a narrow window resize a tile down to 4 columns, as a wide one does', () => {
        const layouts = getDashboardLayouts([chart('a', 0, 0)], true);
        expect(layouts.sm[0].minW).toBe(layouts.lg[0].minW);
        expect(layouts.lg[0].minW).toBe(4);
    });

    it('draws tiles on the same pixels as a grid with a 10px margin', () => {
        const width = 1280;
        const pad = 10;
        const legacyColumn = (width - 2 * pad - 35 * GRID_MARGIN[0]) / 36;
        const legacyLeft = (x: number) =>
            pad + x * (legacyColumn + GRID_MARGIN[0]);
        const legacyWidth = (w: number) =>
            w * legacyColumn + (w - 1) * GRID_MARGIN[0];

        const [padX] = props.containerPadding;
        const column = (width - 2 * padX) / props.cols.lg;
        const gutter = GRID_MARGIN[0] / 2;
        const visibleLeft = (x: number) => padX + x * column + gutter;
        const visibleWidth = (w: number) => w * column - 2 * gutter;

        expect(visibleLeft(14)).toBeCloseTo(legacyLeft(14), 9);
        expect(visibleWidth(7)).toBeCloseTo(legacyWidth(7), 9);
    });
});

describe('saving after a drag or resize', () => {
    it('can rely on one column count, because every editable width uses the same one', () => {
        [1, FINE_GRID_SCALE].forEach((gridScale) => {
            const { cols } = getResponsiveGridLayoutProps({
                isEditMode: true,
                gridScale,
            });
            expect(new Set([cols.lg, cols.md, cols.sm, cols.xs])).toEqual(
                new Set([36 * gridScale]),
            );
        });
    });
});

describe('tiles after a drag or resize', () => {
    type Rect = { x: number; y: number; w: number; h: number };
    const START: Record<string, Rect> = {
        A: { x: 0, y: 0, w: 18, h: 6 },
        B: { x: 18, y: 0, w: 18, h: 6 },
        C: { x: 0, y: 6, w: 18, h: 6 },
        D: { x: 18, y: 6, w: 18, h: 6 },
        E: { x: 0, y: 14, w: 36, h: 6 },
        M: { x: 0, y: 20, w: 36, h: 3 },
    };

    const toLayout = (rects: Record<string, Rect>): Layout[] =>
        Object.entries(rects).map(([i, rect]) => ({ i, ...rect }));

    const positions = (layout: Layout[]): Record<string, Rect> =>
        Object.fromEntries(
            layout.map(({ i, x, y, w, h }) => [i, { x, y, w, h }]),
        );

    const createSession = (initial: Record<string, Rect>) => {
        let saved = { ...initial };
        const home = new Map(
            Object.entries(initial).map(([i, rect]) => [i, rect.y]),
        );
        return {
            drop: (gridLayout: Record<string, Rect>, editedTileId: string) => {
                const settled = settleLayoutAfterEdit({
                    layout: toLayout(gridLayout),
                    editedTileId,
                    previous: new Map(
                        Object.entries(saved).map(([i, rect]) => [
                            i,
                            { i, ...rect },
                        ]),
                    ),
                    home,
                });
                saved = positions(settled);
                home.set(editedTileId, saved[editedTileId].y);
                return saved;
            },
            addTile: (i: string, rect: Rect) => {
                saved = { ...saved, [i]: rect };
                home.set(i, rect.y);
                return saved;
            },
            get saved() {
                return saved;
            },
        };
    };

    const overlapping = (rects: Record<string, Rect>) =>
        Object.entries(rects).flatMap(([a, ra]) =>
            Object.entries(rects)
                .filter(
                    ([b, rb]) =>
                        a < b &&
                        ra.x < rb.x + rb.w &&
                        rb.x < ra.x + ra.w &&
                        ra.y < rb.y + rb.h &&
                        rb.y < ra.y + ra.h,
                )
                .map(([b]) => `${a}/${b}`),
        );

    const hasWholeRows = (rects: Record<string, Rect>) =>
        Object.values(rects).every(
            ({ y, h }) => Number.isInteger(y) && Number.isInteger(h),
        );

    it('resizing a tile taller moves the tile below just enough and keeps the gap above E', () => {
        const session = createSession(START);
        const saved = session.drop(
            { ...START, A: { ...START.A, h: 8 }, C: { ...START.C, y: 8 } },
            'A',
        );
        expect(saved.A.h).toBe(8);
        expect(saved.C.y).toBe(8);
        expect(saved.E.y).toBe(14);
        expect(saved.M.y).toBe(20);
    });

    it('dragging a tile down and back brings the pushed tiles back to their rows', () => {
        const session = createSession(START);
        session.drop(
            {
                ...START,
                A: { ...START.A, y: 3 },
                C: { ...START.C, y: 9 },
                E: { ...START.E, y: 15 },
                M: { ...START.M, y: 21 },
            },
            'A',
        );
        expect(session.saved.E.y).toBe(15);
        const saved = session.drop(
            {
                ...session.saved,
                A: { ...START.A, y: 0 },
            },
            'A',
        );
        expect(saved).toEqual(START);
    });

    it('repeated drag rounds do not ratchet untouched tiles down', () => {
        const session = createSession(START);
        for (let round = 0; round < 3; round += 1) {
            session.drop(
                {
                    ...session.saved,
                    A: { ...START.A, y: 1 },
                    C: { ...START.C, y: 7 },
                },
                'A',
            );
            session.drop(
                {
                    ...session.saved,
                    A: { ...START.A, y: 0 },
                    C: { ...START.C, y: 7 },
                },
                'A',
            );
            expect(session.saved).toEqual(START);
        }
    });

    it('dragging a tile up over others never saves an overlap or a half row on tiles the user did not place', () => {
        const session = createSession(START);
        const saved = session.drop(
            {
                ...START,
                E: { ...START.E, y: 10 },
                C: { ...START.C, y: 9.5 },
                D: { ...START.D, y: 9.5 },
                M: { ...START.M, y: 21 },
            },
            'E',
        );
        expect(overlapping(saved)).toEqual([]);
        expect(hasWholeRows(saved)).toBe(true);
        expect(saved.E.y).toBe(10);
        expect(saved.C.y).toBe(16);
        expect(saved.D.y).toBe(16);
        expect(saved.M.y).toBe(22);
        expect(saved.A).toEqual(START.A);
        expect(saved.B).toEqual(START.B);
    });

    it('a later small drag does not move tiles that the user did not touch', () => {
        const session = createSession(START);
        session.drop(
            {
                ...START,
                E: { ...START.E, y: 10 },
                C: { ...START.C, y: 9.5 },
                D: { ...START.D, y: 9.5 },
                M: { ...START.M, y: 21 },
            },
            'E',
        );
        const afterDrop = session.saved;
        const saved = session.drop(
            {
                ...afterDrop,
                A: { ...START.A, y: 0 },
                E: { ...afterDrop.E, y: 15.5 },
                M: { ...afterDrop.M, y: 21.5 },
            },
            'A',
        );
        expect(saved).toEqual(afterDrop);
    });

    it('a drag after adding a tile keeps the new tile and the gaps', () => {
        const session = createSession(START);
        session.addTile('N', { x: 0, y: 23, w: 15, h: 9 });
        expect(overlapping(session.saved)).toEqual([]);
        const saved = session.drop(
            {
                ...session.saved,
                B: { ...START.B, h: 7 },
                D: { ...START.D, y: 7 },
            },
            'B',
        );
        expect(saved.N).toEqual({ x: 0, y: 23, w: 15, h: 9 });
        expect(saved.D.y).toBe(7);
        expect(saved.E.y).toBe(14);
    });

    it('the edited tile keeps the position the user gave it', () => {
        expect(
            settleLayoutAfterEdit({
                layout: [{ i: 'X', x: 0, y: 3, w: 4, h: 2 }],
                editedTileId: 'X',
                previous: new Map([['X', { i: 'X', x: 0, y: 0, w: 4, h: 2 }]]),
                home: new Map([['X', 0]]),
            }),
        ).toEqual([{ i: 'X', x: 0, y: 3, w: 4, h: 2 }]);
    });

    it('a saved layout reloads to the same positions and a no-op drop keeps them', () => {
        const session = createSession(START);
        session.drop(
            { ...START, A: { ...START.A, h: 8 }, C: { ...START.C, y: 8 } },
            'A',
        );
        const reloaded = createSession(session.saved);
        expect(reloaded.drop(reloaded.saved, 'C')).toEqual(session.saved);
    });

    it('keeps the swap the grid showed when a tile is dragged down past another', () => {
        const session = createSession(START);
        const saved = session.drop(
            {
                ...START,
                A: { ...START.A, y: 7 },
                C: { ...START.C, y: 1 },
                E: { ...START.E, y: 17 },
                M: { ...START.M, y: 23 },
            },
            'A',
        );
        expect(saved.A.y).toBe(7);
        expect(saved.C.y).toBe(1);
        expect(saved.E.y).toBe(14);
        expect(saved.M.y).toBe(20);
        expect(overlapping(saved)).toEqual([]);
    });

    it('a resized tile keeps its top-left corner when the grid pushed it', () => {
        const before = { i: 'C', ...START.C };
        const gridLayout = toLayout({
            ...START,
            C: { ...START.C, y: 12, h: 9 },
        });
        const layout = keepResizedTileCorner(gridLayout, before);
        expect(layout.find((item) => item.i === 'C')).toEqual({
            i: 'C',
            x: 0,
            y: 6,
            w: 18,
            h: 9,
        });
        const session = createSession(START);
        const saved = session.drop(positions(layout), 'C');
        expect(saved.C).toEqual({ x: 0, y: 6, w: 18, h: 9 });
        expect(saved.E.y).toBe(15);
        expect(overlapping(saved)).toEqual([]);
    });

    it('keeps the fine-grid position of the tile the user placed and puts pushed tiles on whole rows', () => {
        const session = createSession(START);
        const saved = session.drop(
            { ...START, B: { ...START.B, y: 0.5 }, D: { ...START.D, y: 6.5 } },
            'B',
        );
        expect(saved.B.y).toBe(0.5);
        expect(saved.D.y).toBe(7);
        expect(overlapping(saved)).toEqual([]);
    });

    it('step ii: a tile dropped at a half row pushes the tiles below it to whole rows', () => {
        const session = createSession(START);
        const saved = session.drop(
            {
                ...START,
                A: { ...START.A, y: 4.5 },
                C: { ...START.C, y: 10.5 },
                E: { ...START.E, y: 16.5 },
                M: { ...START.M, y: 22.5 },
            },
            'A',
        );
        expect(saved.A.y).toBe(4.5);
        expect(saved.C.y).toBe(11);
        expect(saved.E.y).toBe(17);
        expect(saved.M.y).toBe(23);
        expect(saved.B).toEqual(START.B);
        expect(saved.D).toEqual(START.D);
        const { A: _placed, ...untouched } = saved;
        expect(hasWholeRows(untouched)).toBe(true);
        expect(overlapping(saved)).toEqual([]);
    });

    it('a tile swapped above a tile dropped at a half row lands on a whole row', () => {
        const session = createSession(START);
        const saved = session.drop(
            {
                ...START,
                A: { ...START.A, y: 7.5 },
                C: { ...START.C, y: 1.5 },
            },
            'A',
        );
        expect(saved.C.y).toBe(1);
        expect(saved.E.y).toBe(14);
        expect(overlapping(saved)).toEqual([]);
    });

    describe('on the dashboard store', () => {
        const scaled = (rects: Record<string, Rect>): Layout[] =>
            toLayout(rects).map((item) => ({
                ...item,
                x: item.x * FINE_GRID_SCALE,
                y: item.y * FINE_GRID_SCALE,
                w: item.w * FINE_GRID_SCALE,
                h: item.h * FINE_GRID_SCALE,
            }));

        const editing = (rects: Record<string, Rect>) =>
            reducer(
                initialDashboardEditState,
                actions.setTiles(
                    Object.entries(rects).map(([i, { x, y, w, h }]) => ({
                        ...chart(i, x, y, h),
                        w,
                    })),
                ),
            );

        const placements = (state: DashboardEditState) =>
            Object.fromEntries(
                (state.tiles ?? []).map(({ uuid, x, y, w, h }) => [
                    uuid,
                    { x, y, w, h },
                ]),
            );

        const savedRects = (state: DashboardEditState) =>
            new Map(
                Object.entries(placements(state)).map(([i, rect]) => [
                    i,
                    { i, ...rect },
                ]),
            );

        const drop = (
            state: DashboardEditState,
            drawn: Record<string, Rect>,
            tileId: string,
        ) => {
            const [before] = scaled({ [tileId]: placements(state)[tileId] });
            const [after] = scaled({ [tileId]: drawn[tileId] });
            const layout = getLayoutToSaveAfterEdit({
                layout: scaled(drawn),
                before,
                after,
                gridScale: FINE_GRID_SCALE,
                previous: savedRects(state),
                home: new Map(
                    Object.entries(START).map(([i, rect]) => [i, rect.y]),
                ),
            });
            return layout
                ? reducer(
                      state,
                      actions.moveTiles(
                          layout.map(({ i, x, y, w, h }) => ({
                              uuid: i,
                              x,
                              y,
                              w,
                              h,
                          })),
                      ),
                  )
                : state;
        };

        it('saves a drag that pushes several tiles as one undo step, and undo puts every tile back', () => {
            const start = editing(START);
            const moved = drop(
                start,
                {
                    ...START,
                    A: { ...START.A, y: 3 },
                    C: { ...START.C, y: 9 },
                    E: { ...START.E, y: 15 },
                    M: { ...START.M, y: 21 },
                },
                'A',
            );
            expect(placements(moved)).toMatchObject({
                A: { y: 3 },
                C: { y: 9 },
                E: { y: 15 },
                M: { y: 21 },
            });
            expect(moved.tileLayoutHistory.past).toHaveLength(1);
            expect(
                placements(reducer(moved, actions.undoTileLayout())),
            ).toEqual(START);
        });

        it('a drop that moves nothing adds no undo step, while the grid still shows the tile it pushed', () => {
            const start = editing(START);
            const drawn = { ...START, C: { ...START.C, y: 9 } };
            expect(drop(start, drawn, 'A')).toBe(start);
            expect(
                matchesSavedLayout(
                    convertLayoutToBaseCoordinates(
                        scaled(drawn),
                        FINE_GRID_SCALE,
                    ),
                    savedRects(start),
                ),
            ).toBe(false);
            const savedLayout = Object.entries(START).map(([uuid, rect]) => ({
                uuid,
                ...rect,
            }));
            expect(reducer(start, actions.moveTiles(savedLayout))).toBe(start);
            expect(start.tileLayoutHistory.past).toHaveLength(0);
        });

        it('puts pushed and pulled-up tiles on whole rows', () => {
            const pushed = drop(
                editing(START),
                {
                    ...START,
                    A: { ...START.A, y: 4.5 },
                    C: { ...START.C, y: 10.5 },
                    E: { ...START.E, y: 16.5 },
                    M: { ...START.M, y: 22.5 },
                },
                'A',
            );
            expect(placements(pushed)).toMatchObject({
                A: { y: 4.5 },
                C: { y: 11 },
                E: { y: 17 },
                M: { y: 23 },
            });
            const pulledUp = drop(
                pushed,
                { ...placements(pushed), A: { ...START.A, y: 0.5 } },
                'A',
            );
            expect(placements(pulledUp)).toMatchObject({
                A: { y: 0.5 },
                C: { y: 7 },
                E: { y: 14 },
                M: { y: 20 },
            });
            const { A: _placed, ...others } = placements(pulledUp);
            expect(hasWholeRows(others)).toBe(true);
            expect(pulledUp.tileLayoutHistory.past).toHaveLength(2);
        });

        it('a resize keeps the top-left corner of the tile when the grid pushed it', () => {
            const resized = drop(
                editing(START),
                { ...START, C: { ...START.C, y: 12, h: 9 } },
                'C',
            );
            expect(placements(resized)).toMatchObject({
                C: { x: 0, y: 6, w: 18, h: 9 },
                E: { y: 15 },
            });
        });
    });
});

describe('closing the gaps between tiles', () => {
    const at = (uuid: string, x: number, y: number, w = 12, h = 6) => ({
        uuid,
        x,
        y,
        w,
        h,
    });
    const ys = (tiles: ReturnType<typeof at>[]) =>
        Object.fromEntries(tiles.map((tile) => [tile.uuid, tile.y]));

    it('pulls tiles up to the top and onto the tile above', () => {
        const tidy = closeTileGaps([at('a', 0, 3), at('b', 0, 20)]);
        expect(ys(tidy)).toEqual({ a: 0, b: 6 });
    });

    it('leaves a tile under a taller neighbour only as low as its own column needs', () => {
        const tidy = closeTileGaps([
            at('tall', 0, 0, 12, 10),
            at('short', 12, 0, 12, 4),
            at('under-short', 12, 12, 12, 4),
        ]);
        expect(ys(tidy)).toEqual({ tall: 0, short: 0, 'under-short': 4 });
    });

    it('stops a wide tile at the lowest tile it spans', () => {
        const tidy = closeTileGaps([
            at('left', 0, 0, 12, 10),
            at('right', 12, 0, 12, 4),
            at('wide', 0, 30, 24, 4),
        ]);
        expect(ys(tidy).wide).toBe(10);
    });

    it('keeps columns, sizes and half-step positions', () => {
        const tidy = closeTileGaps([
            at('a', 2.5, 4, 7.5, 3.5),
            at('b', 2.5, 9),
        ]);
        expect(tidy).toEqual([at('a', 2.5, 0, 7.5, 3.5), at('b', 2.5, 3.5)]);
    });

    it('changes nothing in a layout without gaps', () => {
        const packed = [at('a', 0, 0), at('b', 12, 0), at('c', 0, 6)];
        expect(closeTileGaps(packed)).toEqual(packed);
    });
});

describe('tidying tiles', () => {
    const at = (uuid: string, x: number, y: number, w: number, h = 6) => ({
        uuid,
        x,
        y,
        w,
        h,
    });

    it('widens a row with spare room to the full grid, keeping proportions', () => {
        expect(tidyTiles([at('a', 0, 0, 8), at('b', 8, 0, 16)])).toEqual([
            at('a', 0, 0, 12),
            at('b', 12, 0, 24),
        ]);
    });

    it('closes a hole in the middle of a row', () => {
        expect(tidyTiles([at('a', 0, 0, 12), at('b', 24, 0, 12)])).toEqual([
            at('a', 0, 0, 18),
            at('b', 18, 0, 18),
        ]);
    });

    it('gives every tile in a row the height of the tallest', () => {
        expect(
            tidyTiles([at('kpi', 0, 0, 12, 3), at('chart', 12, 0, 24, 8)]),
        ).toEqual([at('kpi', 0, 0, 12, 8), at('chart', 12, 0, 24, 8)]);
    });

    it('stacks rows with no space between them', () => {
        expect(
            tidyTiles([
                at('short', 0, 2, 18, 3),
                at('tall', 18, 2, 18, 8),
                at('below', 0, 20, 36, 4),
            ]),
        ).toEqual([
            at('short', 0, 0, 18, 8),
            at('tall', 18, 0, 18, 8),
            at('below', 0, 8, 36, 4),
        ]);
    });

    it('counts tiles whose tops are slightly off as one row', () => {
        expect(
            tidyTiles([
                at('a', 0, 0, 12),
                at('b', 12, 1, 12),
                at('c', 24, 0.5, 12),
            ]),
        ).toEqual([at('a', 0, 0, 12), at('b', 12, 0, 12), at('c', 24, 0, 12)]);
    });

    it('moves a tile stacked under another into the next row', () => {
        expect(
            tidyTiles([
                at('tall', 0, 0, 12, 12),
                at('top', 12, 0, 12),
                at('bottom', 12, 6, 6),
            ]),
        ).toEqual([
            at('tall', 0, 0, 18, 12),
            at('top', 18, 0, 18, 12),
            at('bottom', 0, 12, 36, 6),
        ]);
    });

    it('lands uneven splits on half steps that still span the grid', () => {
        expect(
            tidyTiles([at('a', 0, 0, 5), at('b', 5, 0, 5), at('c', 10, 0, 4)]),
        ).toEqual([
            at('a', 0, 0, 13),
            at('b', 13, 0, 12.5),
            at('c', 25.5, 0, 10.5),
        ]);
    });

    it('leaves a tidy layout as it is', () => {
        const tidy = [at('a', 0, 0, 12), at('b', 12, 0, 24), at('c', 0, 6, 36)];
        expect(tidyTiles(tidy)).toEqual(tidy);
    });

    it('closes gaps first, so tiles pulled level share a row', () => {
        expect(tidyTiles([at('a', 0, 4, 12), at('b', 12, 30, 12)])).toEqual([
            at('a', 0, 0, 18),
            at('b', 18, 0, 18),
        ]);
    });
});
