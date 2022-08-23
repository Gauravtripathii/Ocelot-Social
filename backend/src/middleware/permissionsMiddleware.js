import { rule, shield, deny, allow, or } from 'graphql-shield'
import { getNeode } from '../db/neo4j'
import CONFIG from '../config'
import { validateInviteCode } from '../schema/resolvers/transactions/inviteCodes'

const debug = !!CONFIG.DEBUG
const allowExternalErrors = true

const neode = getNeode()

const isAuthenticated = rule({
  cache: 'contextual',
})(async (_parent, _args, ctx, _info) => {
  return !!(ctx && ctx.user && ctx.user.id)
})

const isModerator = rule()(async (parent, args, { user }, info) => {
  return user && (user.role === 'moderator' || user.role === 'admin')
})

const isAdmin = rule()(async (parent, args, { user }, info) => {
  return user && user.role === 'admin'
})

const onlyYourself = rule({
  cache: 'no_cache',
})(async (parent, args, context, info) => {
  return context.user.id === args.id
})

const isMyOwn = rule({
  cache: 'no_cache',
})(async (parent, args, { user }, info) => {
  return user && user.id === parent.id
})

const isMySocialMedia = rule({
  cache: 'no_cache',
})(async (_, args, { user }) => {
  // We need a User
  if (!user) {
    return false
  }
  let socialMedia = await neode.find('SocialMedia', args.id)
  // Did we find a social media node?
  if (!socialMedia) {
    return false
  }
  socialMedia = await socialMedia.toJson() // whats this for?

  // Is it my social media entry?
  return socialMedia.ownedBy.node.id === user.id
})

const isAllowedSeeingMembersOfGroup = rule({
  cache: 'no_cache',
})(async (_parent, args, { user, driver }) => {
  if (!(user && user.id)) return false
  const { id: groupId } = args
  const session = driver.session()
  const readTxPromise = session.readTransaction(async (transaction) => {
    const transactionResponse = await transaction.run(
      `
        MATCH (group:Group {id: $groupId})
        OPTIONAL MATCH (member:User {id: $userId})-[membership:MEMBER_OF]->(group)
        RETURN group {.*}, member {.*, myRoleInGroup: membership.role}
      `,
      { groupId, userId: user.id },
    )
    return {
      member: transactionResponse.records.map((record) => record.get('member'))[0],
      group: transactionResponse.records.map((record) => record.get('group'))[0],
    }
  })
  try {
    const { member, group } = await readTxPromise
    return (
      !!group &&
      (group.groupType === 'public' ||
        (['closed', 'hidden'].includes(group.groupType) &&
          !!member &&
          ['usual', 'admin', 'owner'].includes(member.myRoleInGroup)))
    )
  } catch (error) {
    throw new Error(error)
  } finally {
    session.close()
  }
})

const isAllowedToChangeGroupMemberRole = rule({
  cache: 'no_cache',
})(async (_parent, args, { user, driver }) => {
  if (!(user && user.id)) return false
  const adminId = user.id
  const { groupId, userId, roleInGroup } = args
  if (adminId === userId) return false
  const session = driver.session()
  const readTxPromise = session.readTransaction(async (transaction) => {
    const transactionResponse = await transaction.run(
      `
        MATCH (admin:User {id: $adminId})-[adminMembership:MEMBER_OF]->(group:Group {id: $groupId})
        OPTIONAL MATCH (group)<-[userMembership:MEMBER_OF]-(member:User {id: $userId})
        RETURN group {.*}, admin {.*, myRoleInGroup: adminMembership.role}, member {.*, myRoleInGroup: userMembership.role}
      `,
      { groupId, adminId, userId },
    )
    return {
      admin: transactionResponse.records.map((record) => record.get('admin'))[0],
      group: transactionResponse.records.map((record) => record.get('group'))[0],
      member: transactionResponse.records.map((record) => record.get('member'))[0],
    }
  })
  try {
    const { admin, group, member } = await readTxPromise
    return (
      !!group &&
      !!admin &&
      (!member ||
        (!!member &&
          (member.myRoleInGroup === roleInGroup || !['owner'].includes(member.myRoleInGroup)))) &&
      ((['admin'].includes(admin.myRoleInGroup) &&
        ['pending', 'usual', 'admin'].includes(roleInGroup)) ||
        (['owner'].includes(admin.myRoleInGroup) &&
          ['pending', 'usual', 'admin', 'owner'].includes(roleInGroup)))
    )
  } catch (error) {
    throw new Error(error)
  } finally {
    session.close()
  }
})

const isAllowedToJoinGroup = rule({
  cache: 'no_cache',
})(async (_parent, args, { user, driver }) => {
  if (!(user && user.id)) return false
  const { groupId, userId } = args
  const session = driver.session()
  const readTxPromise = session.readTransaction(async (transaction) => {
    const transactionResponse = await transaction.run(
      `
        MATCH (group:Group {id: $groupId})
        OPTIONAL MATCH (group)<-[membership:MEMBER_OF]-(member:User {id: $userId})
        RETURN group {.*}, member {.*, myRoleInGroup: membership.role}
      `,
      { groupId, userId },
    )
    return {
      group: transactionResponse.records.map((record) => record.get('group'))[0],
      member: transactionResponse.records.map((record) => record.get('member'))[0],
    }
  })
  try {
    const { group, member } = await readTxPromise
    return !!group && (group.groupType !== 'hidden' || (!!member && !!member.myRoleInGroup))
  } catch (error) {
    throw new Error(error)
  } finally {
    session.close()
  }
})

const isAuthor = rule({
  cache: 'no_cache',
})(async (_parent, args, { user, driver }) => {
  if (!user) return false
  const { id: resourceId } = args
  const session = driver.session()
  const authorReadTxPromise = session.readTransaction(async (transaction) => {
    const authorTransactionResponse = await transaction.run(
      `
        MATCH (resource {id: $resourceId})<-[:WROTE]-(author {id: $userId})
        RETURN author
      `,
      { resourceId, userId: user.id },
    )
    return authorTransactionResponse.records.map((record) => record.get('author'))
  })
  try {
    const [author] = await authorReadTxPromise
    return !!author
  } finally {
    session.close()
  }
})

const isDeletingOwnAccount = rule({
  cache: 'no_cache',
})(async (parent, args, context, _info) => {
  return context.user.id === args.id
})

const noEmailFilter = rule({
  cache: 'no_cache',
})(async (_, args) => {
  return !('email' in args)
})

const publicRegistration = rule()(() => CONFIG.PUBLIC_REGISTRATION)

const inviteRegistration = rule()(async (_parent, args, { user, driver }) => {
  if (!CONFIG.INVITE_REGISTRATION) return false
  const { inviteCode } = args
  const session = driver.session()
  return validateInviteCode(session, inviteCode)
})

// Permissions
export default shield(
  {
    Query: {
      '*': deny,
      findPosts: allow,
      findUsers: allow,
      searchResults: allow,
      searchPosts: allow,
      searchUsers: allow,
      searchHashtags: allow,
      embed: allow,
      Category: allow,
      Tag: allow,
      reports: isModerator,
      statistics: allow,
      currentUser: allow,
      Group: isAuthenticated,
      GroupMembers: isAllowedSeeingMembersOfGroup,
      Post: allow,
      profilePagePosts: allow,
      Comment: allow,
      User: or(noEmailFilter, isAdmin),
      isLoggedIn: allow,
      Badge: allow,
      PostsEmotionsCountByEmotion: allow,
      PostsEmotionsByCurrentUser: isAuthenticated,
      mutedUsers: isAuthenticated,
      blockedUsers: isAuthenticated,
      notifications: isAuthenticated,
      Donations: isAuthenticated,
      userData: isAuthenticated,
      MyInviteCodes: isAuthenticated,
      isValidInviteCode: allow,
      VerifyNonce: allow,
      queryLocations: isAuthenticated,
      availableRoles: isAdmin,
      getInviteCode: isAuthenticated, // and inviteRegistration
    },
    Mutation: {
      '*': deny,
      login: allow,
      Signup: or(publicRegistration, inviteRegistration, isAdmin),
      SignupVerification: allow,
      UpdateUser: onlyYourself,
      CreateGroup: isAuthenticated,
      JoinGroup: isAllowedToJoinGroup,
      ChangeGroupMemberRole: isAllowedToChangeGroupMemberRole,
      CreatePost: isAuthenticated,
      UpdatePost: isAuthor,
      DeletePost: isAuthor,
      fileReport: isAuthenticated,
      CreateSocialMedia: isAuthenticated,
      UpdateSocialMedia: isMySocialMedia,
      DeleteSocialMedia: isMySocialMedia,
      // AddBadgeRewarded: isAdmin,
      // RemoveBadgeRewarded: isAdmin,
      reward: isAdmin,
      unreward: isAdmin,
      followUser: isAuthenticated,
      unfollowUser: isAuthenticated,
      shout: isAuthenticated,
      unshout: isAuthenticated,
      changePassword: isAuthenticated,
      review: isModerator,
      CreateComment: isAuthenticated,
      UpdateComment: isAuthor,
      DeleteComment: isAuthor,
      DeleteUser: or(isDeletingOwnAccount, isAdmin),
      requestPasswordReset: allow,
      resetPassword: allow,
      AddPostEmotions: isAuthenticated,
      RemovePostEmotions: isAuthenticated,
      muteUser: isAuthenticated,
      unmuteUser: isAuthenticated,
      blockUser: isAuthenticated,
      unblockUser: isAuthenticated,
      markAsRead: isAuthenticated,
      AddEmailAddress: isAuthenticated,
      VerifyEmailAddress: isAuthenticated,
      pinPost: isAdmin,
      unpinPost: isAdmin,
      UpdateDonations: isAdmin,
      GenerateInviteCode: isAuthenticated,
      switchUserRole: isAdmin,
      markTeaserAsViewed: allow,
    },
    User: {
      email: or(isMyOwn, isAdmin),
    },
    Report: isModerator,
  },
  {
    debug,
    allowExternalErrors,
    fallbackRule: allow,
  },
)
