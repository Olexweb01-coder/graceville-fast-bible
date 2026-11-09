<script lang="ts">
    // Graceville Fast Bible: developer credit, plus the FreeShow credit its license (GPL-3.0) requires
    import { FREESHOW_SOURCE_URL, GRACEVILLE_DEVELOPER, GRACEVILLE_DEVELOPER_URL } from "../../utils/graceville"
    import Link from "../inputs/Link.svelte"

    export let showFreeShow = false
    export let small = false
</script>

<div class="credit" class:small>
    <span>Developed by <Link url={GRACEVILLE_DEVELOPER_URL}>{GRACEVILLE_DEVELOPER}</Link></span>
    {#if showFreeShow}
        <span class="based">Built on <Link url={FREESHOW_SOURCE_URL}>FreeShow</Link> by ChurchApps · GPL-3.0</span>
    {/if}
</div>

<style>
    .credit {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        font-size: 0.85em;
        opacity: 0.8;
        text-align: center;
    }

    .credit.small {
        font-size: 0.75em;
        padding: 8px 6px;
    }

    .credit :global(a),
    .credit :global(.link) {
        color: var(--secondary);
    }

    .based {
        opacity: 0.75;
        font-size: 0.9em;
    }
</style>
