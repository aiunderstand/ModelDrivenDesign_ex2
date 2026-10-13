// Example 6's Library with its three deliberate mistakes corrected, so that lend() and
// giveBack() make exactly the calls of sequence-lend_book and sequence-return_book.
#include "lending/library.hpp"

namespace lending {

void Library::addBook(const std::string& id, const std::string& title)
{
    catalog_.add(Book(id, title));
}

void Library::enrol(const std::string& id, const std::string& name)
{
    members_.erase(id);
    members_.emplace(id, Member(id, name));
}

bool Library::lend(const std::string& bookId, const std::string& memberId)
{
    Book* book = catalog_.find(bookId);
    if (book == nullptr || !book->isAvailable())
    {
        return false;
    }
    Member* member = findMember(memberId);
    if (member == nullptr)
    {
        return false;
    }
    book->markOnLoan();
    loans_.emplace_back(nextLoanId(), book, member);
    return true;
}

void Library::giveBack(const std::string& bookId)
{
    Book* book = catalog_.find(bookId);
    if (book == nullptr)
    {
        return;
    }
    for (auto loan = loans_.begin(); loan != loans_.end(); ++loan)
    {
        Book* lent = loan->getBook();
        if (lent == book)
        {
            lent->markReturned();
            loans_.erase(loan);
            return;
        }
    }
}

Member* Library::findMember(const std::string& id)
{
    const auto found = members_.find(id);
    return found == members_.end() ? nullptr : &found->second;
}

int Library::nextLoanId() const { return static_cast<int>(loans_.size()) + 1; }

}  // namespace lending
