import { v4 as uuid } from 'uuid'
import { UserInputError } from 'apollo-server'
import CONFIG from '../../config'
import { CATEGORIES_MIN, CATEGORIES_MAX } from '../../constants/categories'
import { DESCRIPTION_WITHOUT_HTML_LENGTH_MIN } from '../../constants/groups'
import { removeHtmlTags } from '../../middleware/helpers/cleanHtml.js'
import Resolver from './helpers/Resolver'

export default {
  Query: {
    Group: async (_object, params, context, _resolveInfo) => {
      const { isMember } = params
      const session = context.driver.session()
      const readTxResultPromise = session.readTransaction(async (txc) => {
        let groupCypher
        if (isMember === true) {
          groupCypher = `
            MATCH (:User {id: $userId})-[membership:MEMBER_OF]->(group:Group)
            RETURN group {.*, myRole: membership.role}
          `
        } else {
          if (isMember === false) {
            groupCypher = `
              MATCH (group:Group)
              WHERE NOT (:User {id: $userId})-[:MEMBER_OF]->(group)
              RETURN group {.*, myRole: NULL}
            `
          } else {
            groupCypher = `
              MATCH (group:Group)
              OPTIONAL MATCH (:User {id: $userId})-[membership:MEMBER_OF]->(group)
              RETURN group {.*, myRole: membership.role}
            `
          }
        }
        const result = await txc.run(groupCypher, {
          userId: context.user.id,
        })
        return result.records.map((record) => record.get('group'))
      })
      try {
        return await readTxResultPromise
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    GroupMembers: async (_object, params, context, _resolveInfo) => {
      const { id: groupId } = params
      // Wolle: console.log('groupId: ', groupId)
      const session = context.driver.session()
      const readTxResultPromise = session.readTransaction(async (txc) => {
        const groupMemberCypher = `
          MATCH (user:User)-[membership:MEMBER_OF]->(:Group {id: $groupId})
          RETURN user {.*, myRoleInGroup: membership.role}
        `
        const result = await txc.run(groupMemberCypher, {
          groupId,
        })
        return result.records.map((record) => record.get('user'))
      })
      try {
        return await readTxResultPromise
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
  },
  Mutation: {
    CreateGroup: async (_parent, params, context, _resolveInfo) => {
      const { categoryIds } = params
      delete params.categoryIds
      if (CONFIG.CATEGORIES_ACTIVE && (!categoryIds || categoryIds.length < CATEGORIES_MIN)) {
        throw new UserInputError('Too view categories!')
      }
      if (CONFIG.CATEGORIES_ACTIVE && categoryIds && categoryIds.length > CATEGORIES_MAX) {
        throw new UserInputError('Too many categories!')
      }
      if (
        params.description === undefined ||
        params.description === null ||
        removeHtmlTags(params.description).length < DESCRIPTION_WITHOUT_HTML_LENGTH_MIN
      ) {
        throw new UserInputError('Description too short!')
      }
      params.id = params.id || uuid()
      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        const categoriesCypher =
          CONFIG.CATEGORIES_ACTIVE && categoryIds
            ? `
                WITH group, membership
                UNWIND $categoryIds AS categoryId
                MATCH (category:Category {id: categoryId})
                MERGE (group)-[:CATEGORIZED]->(category)
              `
            : ''
        const ownerCreateGroupTransactionResponse = await transaction.run(
          `
            CREATE (group:Group)
            SET group += $params
            SET group.createdAt = toString(datetime())
            SET group.updatedAt = toString(datetime())
            WITH group
            MATCH (owner:User {id: $userId})
            MERGE (owner)-[:CREATED]->(group)
            MERGE (owner)-[membership:MEMBER_OF]->(group)
            SET membership.createdAt = toString(datetime())
            SET membership.role = 'owner'
            ${categoriesCypher}
            RETURN group {.*, myRole: membership.role}
          `,
          { userId: context.user.id, categoryIds, params },
        )
        const [group] = await ownerCreateGroupTransactionResponse.records.map((record) =>
          record.get('group'),
        )
        return group
      })
      try {
        return await writeTxResultPromise
      } catch (error) {
        if (error.code === 'Neo.ClientError.Schema.ConstraintValidationFailed')
          throw new UserInputError('Group with this slug already exists!')
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    JoinGroup: async (_parent, params, context, _resolveInfo) => {
      const { groupId, userId } = params
      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        const joinGroupCypher = `
          MATCH (member:User {id: $userId}), (group:Group {id: $groupId})
          MERGE (member)-[membership:MEMBER_OF]->(group)
          ON CREATE SET
            membership.createdAt = toString(datetime()),
            membership.role =
              CASE WHEN group.groupType = 'public'
                THEN 'usual'
                ELSE 'pending'
                END
          RETURN member {.*, myRoleInGroup: membership.role}
        `
        const result = await transaction.run(joinGroupCypher, { groupId, userId })
        const [member] = await result.records.map((record) => record.get('member'))
        return member
      })
      try {
        return await writeTxResultPromise
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
    ChangeGroupMemberRole: async (_parent, params, context, _resolveInfo) => {
      const { groupId, userId, roleInGroup } = params
      // Wolle
      // console.log('ChangeGroupMemberRole !!!')
      // console.log('groupId: ', groupId)
      // console.log('userId: ', userId)
      // console.log('roleInGroup: ', roleInGroup)
      const session = context.driver.session()
      const writeTxResultPromise = session.writeTransaction(async (transaction) => {
        const joinGroupCypher = `
          MATCH (member:User {id: $userId}), (group:Group {id: $groupId})
          MERGE (member)-[membership:MEMBER_OF]->(group)
          ON CREATE SET
            membership.createdAt = toString(datetime()),
            membership.role = $roleInGroup
          ON MATCH SET
            membership.updatedAt = toString(datetime()),
            membership.role = $roleInGroup
          RETURN member {.*, myRoleInGroup: membership.role}
        `
        const result = await transaction.run(joinGroupCypher, { groupId, userId, roleInGroup })
        const [member] = await result.records.map((record) => record.get('member'))
        // Wolle
        // console.log('member: ', member)
        return member
      })
      try {
        return await writeTxResultPromise
      } catch (error) {
        throw new Error(error)
      } finally {
        session.close()
      }
    },
  },
  Group: {
    ...Resolver('Group', {
      hasMany: {
        categories: '-[:CATEGORIZED]->(related:Category)',
      },
    }),
  },
}
