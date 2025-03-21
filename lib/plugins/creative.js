const assert = require('assert')
const { Vec3 } = require('vec3')
const { sleep, onceWithCleanup } = require('../promise_utils')
const { once } = require('../promise_utils')

module.exports = inject

function inject (bot) {
  const Item = require('prismarine-item')(bot.registry)

  // these features only work when you are in creative mode.
  bot.creative = {
    setInventorySlot,
    flyTo,
    startFlying,
    stopFlying,
    clearSlot: slotNum => setInventorySlot(slotNum, null),
    clearInventory
  }

  const creativeSlotsUpdates = []

  // WARN: This method should not be called twice on the same slot before first promise succeeds
  async function setInventorySlot (slot, item, waitTimeout = 400) {
    assert(slot >= 0 && slot <= 44)

    if (Item.equal(bot.inventory.slots[slot], item, true)) return
    if (creativeSlotsUpdates[slot]) {
      throw new Error(`Setting slot ${slot} cancelled due to calling bot.creative.setInventorySlot(${slot}, ...) again`)
    }
    creativeSlotsUpdates[slot] = true
    bot._client.write('set_creative_slot', {
      slot,
      item: Item.toNotch(item)
    })

    if (bot.supportFeature('noAckOnCreateSetSlotPacket')) {
      // No ack
      bot._setSlot(slot, item)
      if (waitTimeout === 0) return // no wait
      // allow some time to see if server rejects
      return new Promise((resolve, reject) => {
        function updateSlot (oldItem, newItem) {
          if (newItem.itemId !== item.itemId) {
            creativeSlotsUpdates[slot] = false
            reject(Error('Server rejected'))
          }
        }
        bot.inventory.once(`updateSlot:${slot}`, updateSlot)
        setTimeout(() => {
          bot.inventory.off(`updateSlot:${slot}`, updateSlot)
          creativeSlotsUpdates[slot] = false
          resolve()
        }, waitTimeout)
      })
    }

    await onceWithCleanup(bot.inventory, `updateSlot:${slot}`, {
      timeout: 5000,
      checkCondition: (oldItem, newItem) => item === null ? newItem === null : newItem?.name === item.name && newItem?.count === item.count && newItem?.metadata === item.metadata
    })
    creativeSlotsUpdates[slot] = false
  }

  async function clearInventory () {
    return Promise.all(bot.inventory.slots.filter(item => item).map(item => setInventorySlot(item.slot, null)))
  }

  const flyingSpeedPerUpdate = 0.5

  // straight line, so make sure there's a clear path.
  async function flyTo (destination) {
    // TODO: consider sending 0x13
    startFlying()

    let vector = destination.minus(bot.entity.position)
    let magnitude = vecMagnitude(vector)

    while (magnitude > flyingSpeedPerUpdate) {
      bot.physicsSettings.gravity = 0
      bot.entity.velocity = new Vec3(0, 0, 0)

      // small steps
      const normalizedVector = vector.scaled(1 / magnitude)
      bot.entity.position.add(normalizedVector.scaled(flyingSpeedPerUpdate))

      await sleep(50)

      vector = destination.minus(bot.entity.position)
      magnitude = vecMagnitude(vector)
    }

    // last step
    bot.entity.position = destination
    await once(bot, 'move', /* no timeout */ 0)
  }

  function startFlying () {
    bot.physicsSettings.overrides.gravity = 0
  }

  function stopFlying () {
    delete bot.physicsSettings.overrides.gravity
  }
}

// this should be in the vector library
function vecMagnitude (vec) {
  return Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z)
}
