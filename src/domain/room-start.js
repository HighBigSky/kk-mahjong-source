import {isPlayerId} from './model.js';

const occupied = seat => Boolean(seat && seat.occupied !== false);

// 同时接受服务端座位和快照座位；断线真人仍然是 occupied 的真人。
export function isSoloHumanBotTable(seats, player) {
  return isPlayerId(player) && Array.isArray(seats) && seats.length === 4 &&
    seats.every((seat,index) => occupied(seat) && (index === player ? seat.bot === false : seat.bot === true));
}

export function canPrepareBotRoom(room, player = 0) {
  return Boolean(room && room.status === 'waiting' && !room.paused && room.owner === player &&
    isPlayerId(player) && Array.isArray(room.seats) && room.seats.length === 4 &&
    occupied(room.seats[player]) && room.seats[player].bot === false &&
    room.seats.every((seat,index) => index === player || !occupied(seat) || seat.bot === true));
}

export function canChooseFourWilds(room, player = 0) {
  return canPrepareBotRoom(room,player) && room.laizi === true &&
    isSoloHumanBotTable(room.seats,player) && room.seats.every(seat => seat.connected === true && seat.ready === true);
}
