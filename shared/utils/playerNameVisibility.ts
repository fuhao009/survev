export function shouldShowPlayerNameLabel({
    playerId,
    activePlayerId,
    playerGroupId,
    activeGroupId,
    showOwnPlayerName,
}: {
    playerId: number;
    activePlayerId: number;
    playerGroupId: number;
    activeGroupId: number;
    showOwnPlayerName: boolean;
}) {
    if (playerGroupId != activeGroupId) {
        return false;
    }
    return playerId != activePlayerId || showOwnPlayerName;
}
